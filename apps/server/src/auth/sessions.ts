import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 90 * DAY_MS;
export const SESSION_EXTEND_AFTER_MS = DAY_MS;
export const SESSION_ABSOLUTE_CAP_MS = 365 * DAY_MS;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');
// Only the hash is stored, so a database leak does not hand out working sessions.
export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();
export const sessionIdOf = (tokenHash: Buffer): string => tokenHash.toString('hex');

export const initialExpiry = (now: Date): Date => new Date(now.getTime() + SESSION_TTL_MS);
// Sliding 90 days, but never past a year after the session was created.
export const extendedExpiry = (createdAt: Date, now: Date): Date =>
  new Date(Math.min(now.getTime() + SESSION_TTL_MS, createdAt.getTime() + SESSION_ABSOLUTE_CAP_MS));

// `__Host-` needs Secure, so plain http (local development) uses the plain name.
export const sessionCookieName = (secure: boolean): string => (secure ? '__Host-upndown_session' : 'upndown_session');
// `__Host-` needs Secure + Path=/, so plain http (local dev) uses a plain name.
export const oauthStateCookieName = (secure: boolean): string => (secure ? '__Host-upndown_oauth_state' : 'upndown_oauth_state');

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSec: number; path: string; secure: boolean }
): string {
  return `${name}=${value}; Max-Age=${options.maxAgeSec}; Path=${options.path}; HttpOnly; SameSite=Strict${options.secure ? '; Secure' : ''}`;
}

export interface OAuthState {
  state: string;
  verifier: string;
  returnPath: string;
  expiresAtMs: number;
}

const sign = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

export function signOAuthState(secret: string, value: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyOAuthState(secret: string, cookie: string | undefined, nowMs: number): OAuthState | null {
  const [payload, signature, extra] = (cookie ?? '').split('.');
  if (!payload || !signature || extra !== undefined || !safeEqual(signature, sign(secret, payload))) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<OAuthState>;
    if (typeof value.state !== 'string' || typeof value.verifier !== 'string' || typeof value.returnPath !== 'string'
      || typeof value.expiresAtMs !== 'number' || value.expiresAtMs < nowMs) {
      return null;
    }
    return value as OAuthState;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

// Relative paths only. Anything that could resolve to another host becomes '/'.
export function sanitizeReturnPath(raw: unknown, publicBaseUrl: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  try {
    const url = new URL(raw, publicBaseUrl);
    if (url.origin !== new URL(publicBaseUrl).origin || url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}
