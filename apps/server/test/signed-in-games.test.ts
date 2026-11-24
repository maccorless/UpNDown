import { describe, expect, it } from 'vitest';
import { SIGNED_IN_ACTIVE_TTL_MS } from '../src/game-manager.js';
import { LIVE_RETENTION_MS } from '../src/live/persistence.js';
import { lobbyWithUsers } from './helpers/rig.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const noOne = new Set<string>();

// A game where every person is signed in is kept for a week of inactivity so a group can play it over several days. A game with a
// guest in it keeps the short time, because a guest's browser is the only place their seat is remembered.
describe('games for signed-in players', () => {
  const started = (seats: Array<{ id: string; userId?: string }>, robots = 0) => {
    const l = lobbyWithUsers(seats);
    for (let i = 0; i < robots; i += 1) l.manager.addRobot(seats[0]!.id, l.gameId);
    l.manager.startGame(seats[0]!.id, l.gameId);
    const touched = (l.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(l.gameId)!.updatedAtMs;
    return { ...l, touched };
  };

  it('keeps a game where everyone is signed in for six days with nobody connected, and removes it after a week', () => {
    const l = started([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    expect(l.manager.reapOrphanedRooms(noOne, l.touched + 6 * DAY)).toEqual([]);
    expect(l.manager.reapOrphanedRooms(noOne, l.touched + SIGNED_IN_ACTIVE_TTL_MS)).toEqual([l.gameId]);
  });

  it('removes a game with a guest in it after thirty minutes, as before', () => {
    const l = started([{ id: 'p1', userId: 'u1' }, { id: 'p2' }]);
    expect(l.manager.reapOrphanedRooms(noOne, l.touched + 29 * MIN)).toEqual([]);
    expect(l.manager.reapOrphanedRooms(noOne, l.touched + 30 * MIN)).toEqual([l.gameId]);
  });

  it('does not count robots as people, so a table of signed-in people and robots keeps the week', () => {
    const l = started([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }], 1);
    expect(l.manager.reapOrphanedRooms(noOne, l.touched + 6 * DAY)).toEqual([]);
  });

  it('is not ended by its robots when the people are all away, because a signed-in group may come back on another day', () => {
    const l = started([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }], 1);
    const now = l.touched;
    l.manager.markDisconnected('p1', now);
    l.manager.markDisconnected('p2', now);
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, now + 10 * MIN)).toBe(false);
    expect(() => l.manager.getRejoinToken(l.gameId, 'p1')).not.toThrow();
  });

  it('still ends a table with a guest and robots once the people are all away, as before', () => {
    const l = started([{ id: 'p1', userId: 'u1' }, { id: 'p2' }], 1);
    const now = l.touched;
    l.manager.markDisconnected('p1', now);
    l.manager.markDisconnected('p2', now);
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, now + 95_000)).toBe(true);
  });

  it('keeps a saved game as long as the longest a game is kept, so a restart reloads a week-old signed-in game', () => {
    expect(LIVE_RETENTION_MS).toBe(SIGNED_IN_ACTIVE_TTL_MS);
  });
});
