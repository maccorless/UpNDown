import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { randomPresidentName, storedSettingsSchema } from '@upndown/shared-types';
import type { ProfileStore } from '../profile/store.js';
import { createIpRateLimiter } from './http-rate-limit.js';
import type { AuthSettings } from './config.js';
import type { Provider } from './providers.js';
import {
  OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, extendedExpiry, hashToken, initialExpiry, newSessionToken, pkceChallenge,
  readCookie, safeEqual, sanitizeReturnPath, serializeCookie, sessionCookieName, sessionIdOf, signOAuthState,
  verifyOAuthState, SESSION_EXTEND_AFTER_MS
} from './sessions.js';

type Log = (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

export interface AuthServices {
  store: ProfileStore;
  providers: Map<string, Provider>;
  settings: AuthSettings;
}

export interface SessionInfo {
  userId: string;
  sessionId: string;
}

export interface AuthRouterOptions {
  // Null until the database answered: auth routes then answer 404 JSON instead of the client page.
  services: () => AuthServices | null;
  trustedProxyHops: number;
  log: Log;
  onSessionRevoked: (sessionId: string) => void;
}

export function createAuthRouter(options: AuthRouterOptions): {
  router: Router;
  stop: () => void;
  sessionFromCookie: (cookieHeader: string | undefined) => Promise<SessionInfo | null>;
} {
  const { services, trustedProxyHops, log, onSessionRevoked } = options;
  const router = Router();
  const limiter = createIpRateLimiter(trustedProxyHops);

  router.get('/api/auth/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const current = services();
    res.json(current ? { enabled: true, providers: [...current.providers.keys()] } : { enabled: false, providers: [] });
  });

  const withServices = (
    name: string,
    limit: number,
    windowMs: number,
    handler: (req: Request, res: Response, current: AuthServices) => Promise<void>
  ) => async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    const current = services();
    if (!current) {
      res.status(404).json({});
      return;
    }
    if (!limiter.allow(req, name, limit, windowMs)) {
      res.status(429).json({});
      return;
    }
    try {
      await handler(req, res, current);
    } catch (err) {
      log('error', 'auth.route_failed', { route: name, error: err instanceof Error ? err.message : 'unknown' });
      if (!res.headersSent) res.status(500).json({});
    }
  };

  const secureOf = (settings: AuthSettings): boolean => settings.publicBaseUrl.startsWith('https:');
  const clearCookie = (res: Response, name: string, path: string, secure: boolean): void => {
    res.append('Set-Cookie', serializeCookie(name, '', { maxAgeSec: 0, path, secure }));
  };

  // Looks the session up and slides its expiry. Null means "treat as guest".
  const resolveSession = async (
    cookieHeader: string | undefined,
    current: AuthServices,
    slide: boolean
  ): Promise<(SessionInfo & { expiresAt: Date; extended: boolean }) | null> => {
    const token = readCookie(cookieHeader, sessionCookieName(secureOf(current.settings)));
    if (!token) return null;
    const tokenHash = hashToken(token);
    const now = new Date();
    const stored = await current.store.findSession(tokenHash, now);
    if (!stored) return null;
    let { expiresAt } = stored;
    let extended = false;
    if (slide && now.getTime() - stored.lastSeenAt.getTime() > SESSION_EXTEND_AFTER_MS) {
      expiresAt = extendedExpiry(stored.createdAt, now);
      await current.store.touchSession(tokenHash, now, expiresAt);
      extended = true;
    }
    return { userId: stored.userId, sessionId: sessionIdOf(tokenHash), expiresAt, extended };
  };

  router.get('/auth/:provider/start', withServices('auth.start', 10, 60_000, async (req, res, current) => {
    const provider = current.providers.get(String(req.params.provider));
    if (!provider) {
      res.status(404).json({});
      return;
    }
    const { settings } = current;
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const cookie = signOAuthState(settings.stateSecret, {
      state,
      verifier,
      returnPath: sanitizeReturnPath(req.query.return, settings.publicBaseUrl),
      expiresAtMs: Date.now() + OAUTH_STATE_TTL_MS
    });
    res.append('Set-Cookie', serializeCookie(OAUTH_STATE_COOKIE, cookie, { maxAgeSec: OAUTH_STATE_TTL_MS / 1000, path: '/auth', secure: secureOf(settings) }));
    res.redirect(302, provider.startUrl({
      redirectUri: `${settings.publicBaseUrl}/auth/${provider.id}/callback`,
      state,
      codeChallenge: pkceChallenge(verifier)
    }));
  }));

  router.get('/auth/:provider/callback', withServices('auth.callback', 20, 60_000, async (req, res, current) => {
    const provider = current.providers.get(String(req.params.provider));
    if (!provider) {
      res.status(404).json({});
      return;
    }
    const { settings } = current;
    const secure = secureOf(settings);
    const fail = (kind: 'cancelled' | 'failed'): void => {
      clearCookie(res, OAUTH_STATE_COOKIE, '/auth', secure);
      res.redirect(302, `${settings.publicBaseUrl}/?login=${kind}`);
    };

    if (typeof req.query.error === 'string') {
      log('info', 'auth.callback_denied', { error: req.query.error.slice(0, 40) });
      fail(req.query.error === 'access_denied' ? 'cancelled' : 'failed');
      return;
    }

    const saved = verifyOAuthState(settings.stateSecret, readCookie(req.headers.cookie, OAUTH_STATE_COOKIE), Date.now());
    const { code, state } = req.query;
    if (!saved || typeof code !== 'string' || typeof state !== 'string' || !safeEqual(state, saved.state)) {
      log('warn', 'auth.callback_rejected', { reason: saved ? 'state mismatch or missing code' : 'missing or invalid state cookie' });
      fail('failed');
      return;
    }

    try {
      const { accessToken } = await provider.exchangeCode({
        code,
        redirectUri: `${settings.publicBaseUrl}/auth/${provider.id}/callback`,
        codeVerifier: saved.verifier
      });
      // Tokens are used once and dropped. Only the provider's user id is kept.
      const profile = await provider.fetchProfile(accessToken);
      const { userId } = await current.store.findOrCreateUser(provider.id, profile.id);
      const token = newSessionToken();
      const expiresAt = initialExpiry(new Date());
      await current.store.createSession(userId, hashToken(token), expiresAt);
      clearCookie(res, OAUTH_STATE_COOKIE, '/auth', secure);
      res.append('Set-Cookie', serializeCookie(sessionCookieName(secure), token, { maxAgeSec: Math.floor((expiresAt.getTime() - Date.now()) / 1000), path: '/', secure }));
      res.redirect(302, `${settings.publicBaseUrl}${saved.returnPath}`);
    } catch (err) {
      log('warn', 'auth.callback_failed', { error: err instanceof Error ? err.message : 'unknown' });
      fail('failed');
    }
  }));

  router.get('/api/me', withServices('api.me', 120, 60_000, async (req, res, current) => {
    const session = await resolveSession(req.headers.cookie, current, true);
    if (!session) {
      res.status(401).json({});
      return;
    }
    let stored = await current.store.getSettings(session.userId);
    if (!stored) {
      res.status(401).json({});
      return;
    }
    // Every account has a name: new ones, and ones made before names existed, get a random president mash-up.
    let playerName = typeof stored.playerName === 'string' && stored.playerName ? stored.playerName : null;
    if (!playerName) {
      playerName = await current.store.ensurePlayerName(session.userId, randomPresidentName());
      if (!playerName) {
        res.status(401).json({});
        return;
      }
      stored = { ...stored, playerName };
    }
    if (session.extended) {
      // The browser's copy would otherwise expire before the extended row does.
      const secure = secureOf(current.settings);
      const token = readCookie(req.headers.cookie, sessionCookieName(secure)) as string;
      res.append('Set-Cookie', serializeCookie(sessionCookieName(secure), token, { maxAgeSec: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000), path: '/', secure }));
    }
    const parsed = storedSettingsSchema.safeParse(stored);
    res.json({ playerName, settings: parsed.success ? parsed.data : { playerName } });
  }));

  // The whole document, last write wins. A body without a name keeps the stored one, so an account is never nameless.
  router.put('/api/me/settings', withServices('api.settings', 60, 60_000, async (req, res, current) => {
    if (!req.is('application/json') || req.headers.origin !== current.settings.publicBaseUrl) {
      res.status(403).json({});
      return;
    }
    const session = await resolveSession(req.headers.cookie, current, true);
    if (!session) {
      res.status(401).json({});
      return;
    }
    if (!limiter.allowUser(session.userId, 'api.settings', 30, 60_000)) {
      res.status(429).json({});
      return;
    }
    const body = storedSettingsSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid settings' });
      return;
    }
    const existing = await current.store.getSettings(session.userId);
    if (!existing) {
      res.status(401).json({});
      return;
    }
    const next = { ...body.data, ...(body.data.playerName === undefined && typeof existing.playerName === 'string' ? { playerName: existing.playerName } : {}) };
    await current.store.replaceSettings(session.userId, next);
    res.json({ settings: next });
  }));

  router.post('/api/auth/logout', withServices('api.logout', 20, 60_000, async (req, res, current) => {
    const { settings } = current;
    // A cross-site form or fetch cannot set a JSON content type with a matching Origin.
    if (!req.is('application/json') || req.headers.origin !== settings.publicBaseUrl) {
      res.status(403).json({});
      return;
    }
    const secure = secureOf(settings);
    const token = readCookie(req.headers.cookie, sessionCookieName(secure));
    if (token) {
      const tokenHash = hashToken(token);
      await current.store.revokeSession(tokenHash);
      onSessionRevoked(sessionIdOf(tokenHash));
    }
    clearCookie(res, sessionCookieName(secure), '/', secure);
    res.json({ ok: true });
  }));

  // For the socket handshake: reads the session without sliding its expiry and never throws.
  const sessionFromCookie = async (cookieHeader: string | undefined): Promise<SessionInfo | null> => {
    const current = services();
    if (!current) return null;
    try {
      const session = await resolveSession(cookieHeader, current, false);
      return session ? { userId: session.userId, sessionId: session.sessionId } : null;
    } catch (err) {
      log('warn', 'auth.session_lookup_failed', { error: err instanceof Error ? err.message : 'unknown' });
      return null;
    }
  };

  return { router, stop: limiter.stop, sessionFromCookie };
}
