import { gameStateSchema } from '@upndown/shared-types';
import { SIGNED_IN_ACTIVE_TTL_MS, type GameManager } from '../game-manager.js';
import type { GameStore } from './game-store.js';
import type { WriterLock } from './advisory-lock.js';

type Log = (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

// A game nobody has touched for this long is not worth keeping, in memory or in the database. Set to the longest a game is
// kept (a week, for signed-in tables): a guest's game is removed from memory after 30 minutes, and its saved copy goes with it.
export const LIVE_RETENTION_MS = SIGNED_IN_ACTIVE_TTL_MS;

// Everything that is saved except the clock.
const fingerprint = (room: ReturnType<GameManager['exportRoom']>): string =>
  room ? JSON.stringify({ s: room.state, u: room.seatUsers, t: room.tokenHashes, r: room.runId }) : '';

export type LiveStatus = 'waiting' | 'ok' | 'down';

interface Options {
  manager: GameManager;
  store: GameStore;
  lock: WriterLock;
  log: Log;
  // Called with the games just loaded after a restart, so their dropped-connection notices can be scheduled.
  onLoaded?: (gameIds: string[]) => void;
  intervalMs?: number;
  retryMs?: number;
  retentionMs?: number;
}

// Saves games being played so they survive a restart, as a sweep: every interval, any game changed since it was last
// written is written, and any saved game that no longer exists (ended, left, reaped) is removed. Doing it as a sweep means
// no move ever waits on the database, and a burst of moves is one write. Writes for a game are one at a time, in order,
// and the room is read fresh when its turn comes, so a game deleted while a write was queued is never brought back.
export class LivePersistence {
  private readonly intervalMs: number;
  private readonly retryMs: number;
  private readonly retentionMs: number;
  // What was last written for each game, as text. A game is dirty when its text differs, which does not depend on a clock
  // that two changes in the same millisecond would share.
  private readonly lastWritten = new Map<string, string>();
  private readonly versions = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private active = false;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private acquireTimer: NodeJS.Timeout | undefined;
  private failing = false;

  constructor(private readonly opts: Options) {
    this.intervalMs = opts.intervalMs ?? 2000;
    this.retryMs = opts.retryMs ?? 3000;
    this.retentionMs = opts.retentionMs ?? LIVE_RETENTION_MS;
    opts.lock.onLost(() => {
      if (this.stopped) return;
      opts.log('warn', 'live.lock_lost', {});
      this.deactivate();
      this.scheduleAcquire();
    });
  }

  status(): LiveStatus {
    if (!this.active) return 'waiting';
    return this.failing ? 'down' : 'ok';
  }

  start(): void {
    void this.tryAcquire();
  }

  private scheduleAcquire(): void {
    if (this.stopped || this.acquireTimer) return;
    this.acquireTimer = setTimeout(() => { this.acquireTimer = undefined; void this.tryAcquire(); }, this.retryMs);
    this.acquireTimer.unref();
  }

  // Waits its turn while another process (the old container during a deploy) holds the lock, serving play from memory.
  private async tryAcquire(): Promise<void> {
    if (this.stopped || this.active) return;
    let got = false;
    try {
      got = await this.opts.lock.tryAcquire();
    } catch {
      got = false;
    }
    if (this.stopped) { await this.opts.lock.release(); return; }
    if (!got) { this.scheduleAcquire(); return; }
    try {
      await this.load();
    } catch (err) {
      this.opts.log('error', 'live.load_failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
    this.active = true;
    this.opts.manager.setActiveTtlMs(this.retentionMs);
    // Games created while waiting have no saved row yet: forget what was written so all of them are written now.
    this.timer = setInterval(() => { void this.sweep(); }, this.intervalMs);
    this.timer.unref();
    void this.sweep();
    this.opts.log('info', 'live.active', {});
  }

  private deactivate(): void {
    this.active = false;
    this.opts.manager.setActiveTtlMs(undefined);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async load(): Promise<void> {
    const { manager, store, log } = this.opts;
    await store.purgeOlderThan(Date.now() - this.retentionMs).catch(() => undefined);
    const rows = await store.loadRecent(Date.now() - this.retentionMs);
    const loaded: string[] = [];
    let dropped = 0;
    for (const { room, version } of rows) {
      const parsed = gameStateSchema.safeParse(room.state);
      if (!parsed.success) {
        // A game this build cannot read (another version, damaged) is dropped rather than guessed at.
        dropped += 1;
        await store.remove(room.gameId).catch(() => undefined);
        continue;
      }
      if (manager.importRoom({ ...room, state: parsed.data as typeof room.state })) {
        loaded.push(room.gameId);
        this.versions.set(room.gameId, version);
        this.lastWritten.set(room.gameId, fingerprint(manager.exportRoom(room.gameId)));
      }
    }
    log('info', 'live.loaded', { games: loaded.length, dropped });
    if (loaded.length > 0) this.opts.onLoaded?.(loaded);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeRoom(gameId: string): Promise<void> {
    const room = this.opts.manager.exportRoom(gameId);
    if (!room) return;
    const print = fingerprint(room);
    const version = (this.versions.get(gameId) ?? 0) + 1;
    const outcome = await this.opts.store.upsert(room, version);
    if (outcome === 'stale') {
      // Someone else has written a newer state: this process no longer owns the games. Stop writing and wait for the lock.
      this.opts.log('warn', 'live.stale_write', { gameId });
      this.deactivate();
      this.scheduleAcquire();
      return;
    }
    this.versions.set(gameId, version);
    this.lastWritten.set(gameId, print);
  }

  async sweep(): Promise<void> {
    if (!this.active) return;
    await this.enqueue(async () => {
      if (!this.active) return;
      try {
        const live = new Set(this.opts.manager.savableGameIds());
        for (const gameId of live) {
          if (this.lastWritten.get(gameId) !== fingerprint(this.opts.manager.exportRoom(gameId))) await this.writeRoom(gameId);
          if (!this.active) return;
        }
        for (const gameId of [...this.lastWritten.keys()]) {
          if (live.has(gameId)) continue;
          await this.opts.store.remove(gameId);
          this.lastWritten.delete(gameId);
          this.versions.delete(gameId);
        }
        if (this.failing) this.opts.log('info', 'live.recovered', {});
        this.failing = false;
      } catch (err) {
        // Once per outage, not once per sweep. Play is never affected: the game runs from memory as it always did.
        if (!this.failing) this.opts.log('warn', 'live.write_failed', { error: err instanceof Error ? err.name : 'unknown' });
        this.failing = true;
      }
    });
  }

  // Writes one game now and waits for it, for the moment a seat is handed a new credential: a restart right after must
  // not leave a player holding a token the database has never seen. Gives up quickly rather than hold up play.
  async flush(gameId: string, timeoutMs = 1500): Promise<void> {
    if (!this.active) return;
    const write = this.enqueue(async () => {
      try {
        await this.writeRoom(gameId);
        this.failing = false;
      } catch {
        this.failing = true;
      }
    });
    await Promise.race([write, new Promise<void>((resolve) => { setTimeout(resolve, timeoutMs).unref(); })]);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.acquireTimer) clearTimeout(this.acquireTimer);
    // One last sweep so the newest moves are not lost to a deploy, then let go of the lock for the next process.
    if (this.active) await Promise.race([this.sweep(), new Promise<void>((resolve) => { setTimeout(resolve, 3000).unref(); })]);
    this.active = false;
    await this.opts.lock.release();
  }
}
