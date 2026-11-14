import { describe, expect, it, vi } from 'vitest';
import { lobbyWithUsers } from './helpers/rig.js';

// The engine checks for a win or a loss as it deals, so a game can be over the moment it starts. Starting is not a
// transition anyone plays, which is exactly why it is easy to forget to record it.
vi.mock('@upndown/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@upndown/engine')>();
  return {
    ...real,
    createStartedGameState: (args: Parameters<typeof real.createStartedGameState>[0]) => {
      const started = real.createStartedGameState(args);
      return { ...started, gamePhase: 'lost' as const, statistics: { ...started.statistics, endedAtMs: started.statistics.startedAtMs } };
    }
  };
});

describe('a game that is over as it starts', () => {
  it('is recorded as a loss for the signed-in players, under its run id', () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }, { id: 'p3' }]);
    const started = l.manager.startGame('p1', l.gameId);
    expect(started.gamePhase).toBe('lost');
    expect(l.rows().map((r) => [r.userId, r.outcome]).sort()).toEqual([['u1', 'lost'], ['u2', 'lost']]);
    expect(l.rows()[0]!.durationMs).toBe(0);
    expect(l.rows()[0]!.gameId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is not recorded a second time when the finished room is returned to the lobby', () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.startGame('p1', l.gameId);
    l.manager.endGame('p1', l.gameId);
    expect(l.batches).toHaveLength(1);
  });
});
