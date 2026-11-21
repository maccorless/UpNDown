import { describe, expect, it } from 'vitest';
import { lobbyWithUsers } from './helpers/rig.js';

const MIN = 60_000;

// A room with nobody connected is not necessarily dead: everyone's phone can drop at once and come back. Deleting a
// started game is destructive and silent (no result is written), so what removes rooms, and when, has to be pinned.
describe('what removes rooms with nobody connected', () => {
  const startedRoom = () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.startGame('p1', l.gameId);
    return l;
  };
  const noOne = new Set<string>();

  it('keeps a started game for 30 minutes after it was last touched, then removes it', () => {
    const l = startedRoom();
    const touched = l.room().gameState && (l.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(l.gameId)!.updatedAtMs;
    expect(l.manager.reapOrphanedRooms(noOne, touched + 29 * MIN + 59_000)).toEqual([]);
    expect(() => l.manager.getRejoinToken(l.gameId, 'p1')).not.toThrow();
    expect(l.manager.reapOrphanedRooms(noOne, touched + 30 * MIN)).toEqual([l.gameId]);
    expect(() => l.manager.getRejoinToken(l.gameId, 'p1')).toThrow();
  });

  it('keeps an empty lobby for 5 minutes, then removes it', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    const touched = (l.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(l.gameId)!.updatedAtMs;
    expect(l.manager.reapOrphanedRooms(noOne, touched + 4 * MIN + 59_000)).toEqual([]);
    expect(l.manager.reapOrphanedRooms(noOne, touched + 5 * MIN)).toEqual([l.gameId]);
  });

  it('never removes a room while anyone in it is connected, however old', () => {
    const l = startedRoom();
    const touched = (l.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(l.gameId)!.updatedAtMs;
    expect(l.manager.reapOrphanedRooms(new Set(['p2']), touched + 24 * 60 * MIN)).toEqual([]);
  });

  it('removes a lobby nobody has touched for an hour even while someone is connected, but never a started game', () => {
    const lobby = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    const touched = (lobby.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(lobby.gameId)!.updatedAtMs;
    expect(lobby.manager.reapOrphanedRooms(new Set(['p1']), touched + 59 * MIN)).toEqual([]);
    expect(lobby.manager.reapOrphanedRooms(new Set(['p1']), touched + 60 * MIN)).toEqual([lobby.gameId]);
  });

  it('forgets the room\'s reactions with the room, so nothing is left behind', () => {
    const l = startedRoom();
    const manager = l.manager as unknown as { reactions: Map<string, unknown> };
    const current = l.room().gameState.players[l.room().gameState.currentPlayerIndex]!.id;
    const other = current === 'p1' ? 'p2' : 'p1';
    l.manager.setReaction(l.gameId, other, 0, 'like');
    expect(manager.reactions.has(l.gameId)).toBe(true);
    const touched = (l.manager as unknown as { rooms: Map<string, { updatedAtMs: number }> }).rooms.get(l.gameId)!.updatedAtMs;
    l.manager.reapOrphanedRooms(noOne, touched + 31 * MIN);
    expect(manager.reactions.has(l.gameId)).toBe(false);
  });

  it('forgets the reactions when the last player leaves a room too', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    const manager = l.manager as unknown as { reactions: Map<string, unknown> };
    const current = l.room().gameState.players[l.room().gameState.currentPlayerIndex]!.id;
    l.manager.setReaction(l.gameId, current === 'p1' ? 'p2' : 'p1', 0, 'like');
    l.manager.endGame('p1', l.gameId);
    l.manager.leaveGame('p1', l.gameId);
    l.manager.leaveGame('p2', l.gameId);
    expect(manager.reactions.has(l.gameId)).toBe(false);
  });
});

// The regression: opening the lobby list used to delete started games whose players had all dropped.
describe('opening the lobby list', () => {
  it('leaves a started game alone even when none of its players is connected, so they can rejoin', () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.startGame('p1', l.gameId);
    const token = l.manager.getRejoinToken(l.gameId, 'p1');
    expect(l.manager.listJoinableGames(new Set(['a-stranger']))).toEqual([]);
    expect(() => l.manager.rejoinPlayer(l.gameId, 'p1', 'p1-back', token, 'u1')).not.toThrow();
    expect(l.room().gameState.gamePhase).toBe('playing');
  });

  it('leaves a finished game alone too, so players can still see how it ended', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    l.room().gameState = { ...l.room().gameState, gamePhase: 'won' };
    l.manager.listJoinableGames(new Set());
    expect(() => l.manager.getRejoinToken(l.gameId, 'p1')).not.toThrow();
  });

  it('lists a lobby while someone in it is connected, and not once they are all gone', () => {
    const l = lobbyWithUsers([{ id: 'p1' }]);
    expect(l.manager.listJoinableGames(new Set(['p1'])).map((g) => g.gameId)).toEqual([l.gameId]);
    expect(l.manager.listJoinableGames(new Set())).toEqual([]);
  });
});
