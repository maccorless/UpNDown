import type { RequestHandler, Router } from 'express';
import pg from 'pg';
import { migrate } from '../db/migrate.js';
import { PgProfileStore, type ProfileStore } from '../profile/store.js';
import { resolveAuthSettings, type AuthSettings } from './config.js';
import { legacyHostRedirect } from './legacy-host.js';
import { createGoogleProvider, type Provider } from './providers.js';
import { createAuthRouter, type AuthServices, type SessionInfo } from './routes.js';

type Log = (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

export interface AuthRuntime {
  router: Router;
  legacyRedirect: RequestHandler;
  isEnabled(): boolean;
  sessionFromCookie(cookieHeader: string | undefined): Promise<SessionInfo | null>;
  onSessionRevoked(listener: (sessionId: string) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Tests only. Production never passes these, so no flag or missing setting can register a fake provider.
export interface AuthTestOverrides {
  settings: AuthSettings;
  store: ProfileStore;
  provider: Provider;
}

const SESSION_SWEEP_MS = 60 * 60 * 1000;

// Auth is on only when every setting is present and the database answered and migrated. Anything
// less leaves it off and the game runs for guests: the game never depends on the database.
export function createAuthRuntime(
  env: Record<string, string | undefined>,
  log: Log,
  options: { trustedProxyHops?: number; overrides?: AuthTestOverrides } = {}
): AuthRuntime {
  const resolved = resolveAuthSettings(env);
  const { overrides } = options;
  let services: AuthServices | null = null;
  let pool: pg.Pool | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  const revokedListeners: Array<(sessionId: string) => void> = [];

  const { router, stop: stopRouter, sessionFromCookie } = createAuthRouter({
    services: () => services,
    trustedProxyHops: options.trustedProxyHops ?? 0,
    log,
    onSessionRevoked: (sessionId) => revokedListeners.forEach((listener) => listener(sessionId))
  });

  const startSweep = (store: ProfileStore): void => {
    const sweep = (): void => {
      store.deleteExpiredSessions(new Date()).catch((err: unknown) => log('warn', 'auth.session_sweep_failed', { error: err instanceof Error ? err.message : 'unknown' }));
    };
    sweep();
    sweepTimer = setInterval(sweep, SESSION_SWEEP_MS);
    sweepTimer.unref();
  };

  return {
    router,
    legacyRedirect: legacyHostRedirect(() => (services && services.settings.legacyHost
      ? { legacyHost: services.settings.legacyHost, publicBaseUrl: services.settings.publicBaseUrl }
      : null)),
    isEnabled: () => services !== null,
    sessionFromCookie,
    onSessionRevoked: (listener) => { revokedListeners.push(listener); },
    async start() {
      if (overrides) {
        services = { store: overrides.store, providers: new Map([[overrides.provider.id, overrides.provider]]), settings: overrides.settings };
        return;
      }
      if (!resolved.configured) {
        log('info', 'auth.disabled', { reason: resolved.reason });
        return;
      }
      const { settings } = resolved;
      const candidate = new pg.Pool({ connectionString: settings.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
      // An idle client dropped by the server must not crash the process.
      candidate.on('error', (err) => log('warn', 'auth.db_pool_error', { error: err.message }));
      try {
        const applied = await migrate(candidate);
        pool = candidate;
        const store = new PgProfileStore(candidate);
        services = { store, providers: new Map([['google', createGoogleProvider(settings.googleClientId, settings.googleClientSecret)]]), settings };
        startSweep(store);
        log('info', 'auth.enabled', { migrationsApplied: applied, legacyHost: settings.legacyHost ?? null });
      } catch (err) {
        await candidate.end().catch(() => undefined);
        log('error', 'auth.disabled', { reason: 'database unavailable', error: err instanceof Error ? err.message : 'unknown' });
      }
    },
    async stop() {
      services = null;
      if (sweepTimer) clearInterval(sweepTimer);
      stopRouter();
      await pool?.end();
      pool = undefined;
    }
  };
}
