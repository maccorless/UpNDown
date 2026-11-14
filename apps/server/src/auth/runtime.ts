import { Router } from 'express';
import pg from 'pg';
import { migrate } from '../db/migrate.js';
import { resolveAuthSettings } from './config.js';

type Log = (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

export interface AuthRuntime {
  isEnabled(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Auth is on only when every setting is present and the database answered and migrated. Anything
// less leaves it off and the game runs for guests: the game never depends on the database.
export function createAuthRuntime(env: Record<string, string | undefined>, log: Log): AuthRuntime {
  const resolved = resolveAuthSettings(env);
  let pool: pg.Pool | undefined;
  let enabled = false;

  return {
    isEnabled: () => enabled,
    async start() {
      if (!resolved.configured) {
        log('info', 'auth.disabled', { reason: resolved.reason });
        return;
      }
      const candidate = new pg.Pool({ connectionString: resolved.settings.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
      // An idle client dropped by the server must not crash the process.
      candidate.on('error', (err) => log('warn', 'auth.db_pool_error', { error: err.message }));
      try {
        const applied = await migrate(candidate);
        pool = candidate;
        enabled = true;
        log('info', 'auth.enabled', { migrationsApplied: applied });
      } catch (err) {
        await candidate.end().catch(() => undefined);
        log('error', 'auth.disabled', { reason: 'database unavailable', error: err instanceof Error ? err.message : 'unknown' });
      }
    },
    async stop() {
      enabled = false;
      await pool?.end();
      pool = undefined;
    }
  };
}

export function authRouter(auth: AuthRuntime): Router {
  const router = Router();
  router.get('/api/auth/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(auth.isEnabled() ? { enabled: true, providers: ['google'] } : { enabled: false, providers: [] });
  });
  return router;
}
