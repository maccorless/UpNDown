import type { ResultRow } from '@upndown/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { moveHistory } from './moveHistory.js';
import { row } from './profile-fixtures.js';

type Req = { rows: ResultRow[] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ids = (n: number): ResultRow[] => Array.from({ length: n }, (_v, i) => row({ gameId: `mv-${String(i).padStart(4, '0')}` }));
const seed = (rows: ResultRow[]) => { const h = createLocalHistory(); rows.forEach((r) => h.add(r)); return h; };

// A server that remembers what it has been given, as the real one does.
function server(opts: { rejectIds?: Set<string>; full?: boolean } = {}) {
  const have = new Set<string>();
  const sizes: number[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Req;
    sizes.push(body.rows.length);
    return json({ results: body.rows.map((r) => {
      if (opts.full) return { gameId: r.gameId, status: 'rejected', reason: 'history full' };
      if (opts.rejectIds?.has(r.gameId)) return { gameId: r.gameId, status: 'rejected', reason: 'invalid' };
      const dup = have.has(r.gameId);
      have.add(r.gameId);
      return { gameId: r.gameId, status: dup ? 'duplicate' : 'inserted' };
    }) });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  return { have, sizes, fetchImpl };
}
const noWait = async () => undefined;

describe('moving a guest\'s history into an account', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('sends it in small batches, and a game leaves the device only after the server has it', async () => {
    const history = seed(ids(1_200));
    const s = server();
    const remainingAtEachRequest: number[] = [];
    const wrapped = (async (url: string, init?: RequestInit) => { remainingAtEachRequest.push(history.load().rows.length); return s.fetchImpl(url, init); }) as typeof fetch;
    const result = await moveHistory(history, wrapped, noWait);
    expect(result).toEqual({ moved: 1_200, remaining: 0, refused: 0, error: 'none' });
    expect(Math.max(...s.sizes)).toBeLessThanOrEqual(150);
    expect(s.sizes.length).toBeGreaterThanOrEqual(8);
    expect(remainingAtEachRequest).toEqual([...remainingAtEachRequest].sort((a, b) => b - a));
    expect(s.have.size).toBe(1_200);
  });

  it('keeps every request under the server\'s own size bound', async () => {
    const history = seed(ids(400));
    const bodies: number[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => { bodies.push((init!.body as string).length); return json({ results: (JSON.parse(init!.body as string) as Req).rows.map((r) => ({ gameId: r.gameId, status: 'inserted' })) }); }) as typeof fetch;
    await moveHistory(history, fetchImpl, noWait);
    expect(Math.max(...bodies)).toBeLessThan(90_000);
  });

  it('stops when the connection drops, keeps what was not sent, and carries on from there next time (nothing lost, nothing sent twice)', async () => {
    const history = seed(ids(400));
    const s = server();
    let calls = 0;
    const flaky = (async (url: string, init?: RequestInit) => { calls += 1; if (calls === 2) throw new TypeError('Failed to fetch'); return s.fetchImpl(url, init); }) as typeof fetch;
    const first = await moveHistory(history, flaky, noWait);
    expect(first).toMatchObject({ error: 'offline', moved: 150, remaining: 250 });
    // The page was closed: a new store over the same storage sees the rest.
    const reopened = createLocalHistory();
    expect(reopened.load().rows).toHaveLength(250);
    const second = await moveHistory(reopened, s.fetchImpl, noWait);
    expect(second).toMatchObject({ error: 'none', remaining: 0, moved: 250 });
    expect(s.have.size).toBe(400);
  });

  it('adds nothing twice when it is run again over games the account already has', async () => {
    const rows = ids(5);
    const s = server();
    await moveHistory(seed(rows), s.fetchImpl, noWait);
    window.localStorage.clear();
    const again = await moveHistory(seed(rows), s.fetchImpl, noWait);
    expect(again).toMatchObject({ remaining: 0, error: 'none' });
    expect(s.have.size).toBe(5);
  });

  it('keeps a game the server refused, set apart, and says so, instead of deleting it', async () => {
    const rows = ids(3);
    const history = seed(rows);
    const result = await moveHistory(history, server({ rejectIds: new Set([rows[1]!.gameId]) }).fetchImpl, noWait);
    expect(result).toEqual({ moved: 2, remaining: 0, refused: 1, error: 'rejected' });
    expect(history.load().rejected.map((r) => r.gameId)).toEqual([rows[1]!.gameId]);
  });

  it('waits and carries on when the server says slow down, without losing a game', async () => {
    const history = seed(ids(10));
    const s = server();
    let throttle = 2;
    const slow = (async (url: string, init?: RequestInit) => (throttle-- > 0 ? new Response('{}', { status: 429 }) : s.fetchImpl(url, init))) as typeof fetch;
    const wait = vi.fn(async () => undefined);
    const result = await moveHistory(history, slow, wait);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ moved: 10, remaining: 0, error: 'none' });
  });

  it('keeps the games on the device when the account is full, and says that is why', async () => {
    const history = seed(ids(4));
    const result = await moveHistory(history, server({ full: true }).fetchImpl, noWait);
    expect(result).toMatchObject({ error: 'full', remaining: 4, moved: 0, refused: 0 });
  });

  it.each([[401], [500], [413]])('keeps everything when the server answers %i', async (status) => {
    const history = seed(ids(4));
    const result = await moveHistory(history, (async () => new Response('{}', { status })) as typeof fetch, noWait);
    expect(result).toMatchObject({ error: 'server', remaining: 4 });
  });

  it('does not loop forever on a reply that accepts nothing and refuses nothing', async () => {
    const history = seed(ids(3));
    const result = await moveHistory(history, (async () => json({ results: [] })) as typeof fetch, noWait);
    expect(result).toMatchObject({ error: 'server', remaining: 3 });
  });
});
