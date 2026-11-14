import type { RequestHandler, Router } from 'express';
import pg from 'pg';
import { migrate } from '../db/migrate.js';
import { PgProfileStore, type GameResultRow, type ProfileStore } from '../profile/store.js';
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
  // Fire and forget. A no-op when auth is off. Failures are logged here, once, and the rows are dropped: no retry, no queue.
  recordResults(rows: GameResultRow[]): void;
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
  options: { trustedProxyHops?: number; overrides?: AuthTestOverrides; drainTimeoutMs?: number } = {}
): AuthRuntime {
  const resolved = resolveAuthSettings(env);
  const { overrides } = options;
  let services: AuthServices | null = null;
  let pool: pg.Pool | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  const revokedListeners: Array<(sessionId: string) => void> = [];
  const pendingWrites = new Set<Promise<void>>();
  const drainTimeoutMs = options.drainTimeoutMs ?? 5000;

  // Waits for writes in flight, including ones that start while it waits, but never longer than the timeout: a stuck
  // database must not hold a redeploy hostage. Results that arrive after that are best effort.
  const drain = async (): Promise<void> => {
    const deadline = Date.now() + drainTimeoutMs;
    while (pendingWrites.size > 0 && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...pendingWrites]),
        new Promise<void>((resolve) => { setTimeout(resolve, Math.max(0, deadline - Date.now())).unref(); })
      ]);
    }
  };

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
    recordResults(rows) {
      const current = services;
      if (!current || rows.length === 0) return;
      const runId = rows[0]?.gameId;
      const job: Promise<void> = current.store.recordResults(rows)
        .then((outcomes) => {
          const count = (outcome: string): number => outcomes.filter((o) => o.outcome === outcome).length;
          log('info', 'game.results_recorded', { runId, rows: rows.length, inserted: count('inserted'), duplicate: count('duplicate'), userMissing: count('user_missing'), failed: count('failed') });
          const failed = outcomes.filter((o) => o.outcome === 'failed');
          // Codes only: a database error message can carry the values that were being written.
          if (failed.length > 0) log('warn', 'game.result_write_failed', { runId, count: failed.length, codes: [...new Set(failed.map((f) => f.code ?? 'unknown'))] });
        })
        .catch((err: unknown) => {
          log('warn', 'game.result_write_failed', { runId, count: rows.length, codes: [err instanceof Error ? err.name : 'unknown'] });
        })
        .finally(() => { pendingWrites.delete(job); });
      pendingWrites.add(job);
    },
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
      await drain();
      services = null;
      if (sweepTimer) clearInterval(sweepTimer);
      stopRouter();
      await pool?.end();
      pool = undefined;
    }
  };
}
