import type { SolitaireResultPayload } from '@upndown/shared-types';
import { defaultSolitaireSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createOutbox, startOutboxDrain, type SendResult } from './outbox.js';

class Mem implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}
const game = (gameId: string): SolitaireResultPayload => ({
  gameId, outcome: 'won', startedAtMs: 1, endedAtMs: 2, turns: 1, cardsTotal: 98, cardsLeft: 0, cardsPlayed: 98, totalMovement: 1, specialPlays: 0,
  nasCheats: 0, skips: 0, trades: 0, lookups: 0, hints: 0, settings: defaultSolitaireSettings
});
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

describe('the outbox', () => {
  it('keeps a game once however many times it is queued, and keeps each account\'s games apart', () => {
    const storage = new Mem();
    const a = createOutbox('user-a', storage);
    a.enqueue(game('g1'));
    a.enqueue(game('g1'));
    expect(a.pending()).toHaveLength(1);
    expect(createOutbox('user-b', storage).pending()).toEqual([]);
    a.remove('g1');
    expect(a.pending()).toEqual([]);
  });

  it('survives unreadable storage by holding nothing rather than throwing', () => {
    const storage = new Mem();
    storage.setItem('upndown.outbox.v1.u', '{oops');
    expect(createOutbox('u', storage).pending()).toEqual([]);
  });
});

describe('draining the outbox', () => {
  it('sends what is waiting and removes each game only when the server has answered for it', async () => {
    const outbox = createOutbox('u', new Mem());
    outbox.enqueue(game('a')); outbox.enqueue(game('b'));
    const answers: Record<string, SendResult> = { a: 'ok', b: 'permanent' };
    const drain = startOutboxDrain(outbox, async (p) => answers[p.gameId]!);
    drain.kick();
    await flush();
    expect(outbox.pending()).toEqual([]);
    drain.stop();
  });

  it('keeps a game, and waits longer each time, while the answer is retry (offline, throttled or signed out)', async () => {
    vi.useFakeTimers();
    const outbox = createOutbox('u', new Mem());
    outbox.enqueue(game('a'));
    const send = vi.fn(async (): Promise<SendResult> => 'retry');
    const drain = startOutboxDrain(outbox, send);
    drain.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(outbox.pending()).toHaveLength(1);
    drain.stop();
    vi.useRealTimers();
  });

  it('drains a backlog of 40 across a limit of 30 a minute without losing one', async () => {
    vi.useFakeTimers();
    const outbox = createOutbox('u', new Mem());
    for (let i = 0; i < 40; i += 1) outbox.enqueue(game(`g${i}`));
    let sentThisMinute = 0;
    const send = vi.fn(async (): Promise<SendResult> => (sentThisMinute < 30 ? (sentThisMinute += 1, 'ok') : 'retry'));
    const drain = startOutboxDrain(outbox, send);
    drain.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.pending()).toHaveLength(10);
    sentThisMinute = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outbox.pending()).toEqual([]);
    drain.stop();
    vi.useRealTimers();
  });

  it('tries again the moment the browser says it is back online', async () => {
    vi.useFakeTimers();
    const outbox = createOutbox('u', new Mem());
    outbox.enqueue(game('a'));
    let online = false;
    const drain = startOutboxDrain(outbox, async () => (online ? 'ok' : 'retry'));
    drain.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.pending()).toHaveLength(1);
    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.pending()).toEqual([]);
    drain.stop();
    vi.useRealTimers();
  });

  it('never sends another account\'s games', async () => {
    const storage = new Mem();
    createOutbox('user-a', storage).enqueue(game('theirs'));
    const mine = createOutbox('user-b', storage);
    mine.enqueue(game('mine'));
    const sent: string[] = [];
    const drain = startOutboxDrain(mine, async (p) => { sent.push(p.gameId); return 'ok'; });
    drain.kick();
    await flush();
    expect(sent).toEqual(['mine']);
    expect(createOutbox('user-a', storage).pending()).toHaveLength(1);
    drain.stop();
  });
});
