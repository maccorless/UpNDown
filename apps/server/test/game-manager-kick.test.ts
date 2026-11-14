import type { GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { lobbyWithUsers, rig } from './helpers/rig.js';

const table = (seats = 3) => lobbyWithUsers(Array.from({ length: seats }, (_, i) => ({ id: `p${i + 1}`, userId: `u${i + 1}` })));
const started = (seats = 3) => { const l = table(seats); l.manager.startGame('p1', l.gameId); return l; };
const cardsInPlay = (s: GameState): string[] => [...s.drawPile, ...s.players.flatMap((p) => p.hand), ...s.foundationPiles.map((p) => p.topCard)].map((c) => c.id).sort();

// A player whose connection dropped keeps their seat in a live game, so a game is not lost to a flaky phone. The host is
// the one who can free that seat, and their cards must go back into the game rather than vanish.
describe('the host kicks a disconnected player from a live game', () => {
  it('keeps a disconnected player seated while the game is being played, so there is someone to kick', () => {
    const l = started();
    expect(l.manager.removeDisconnectedPlayer('p2')).toEqual([]);
    expect(l.room().gameState.players.map((p) => p.id)).toContain('p2');
  });

  it('lets the host kick that seat, and puts the kicked player\'s whole hand back into the draw pile', () => {
    const l = started();
    l.manager.removeDisconnectedPlayer('p2');
    const before = l.room().gameState;
    const hand = before.players.find((p) => p.id === 'p2')!.hand.map((c) => c.id);
    expect(hand.length).toBeGreaterThan(0);

    const after = l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(after.players.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(after.drawPile).toHaveLength(before.drawPile.length + hand.length);
    const pile = new Set(after.drawPile.map((c) => c.id));
    for (const id of hand) expect(pile.has(id)).toBe(true);
    // Nothing is lost or duplicated: every card is still in the game exactly once.
    expect(cardsInPlay(after)).toEqual(cardsInPlay(before));
  });

  // The returned cards are mixed through the pile. Tacking them on the end would hand them to whoever draws next.
  it('mixes the returned cards through the draw pile instead of putting them on the end', () => {
    const tailOnly = { positions: new Set<number>(), allAtEnd: 0 };
    const trials = 150;
    for (let i = 0; i < trials; i += 1) {
      const l = started();
      const hand = new Set(l.room().gameState.players.find((p) => p.id === 'p2')!.hand.map((c) => c.id));
      const pile = l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' }).drawPile;
      const firstIndex = pile.findIndex((c) => hand.has(c.id));
      tailOnly.positions.add(firstIndex);
      if (firstIndex === pile.length - hand.size) tailOnly.allAtEnd += 1;
    }
    // Over many kicks the first returned card lands all over the pile, almost never in the one position "appended" would give.
    expect(tailOnly.positions.size).toBeGreaterThan(20);
    expect(tailOnly.allAtEnd).toBeLessThan(trials * 0.2);
  });

  it('keeps the game going for the others: the kicked player\'s turn passes on, and their counters are gone', () => {
    const l = started();
    rig(l.room, (s) => { s.currentPlayerIndex = 1; s.cardsPlayedThisTurn = 1; });
    const after = l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(after.gamePhase).toBe('playing');
    expect(after.cardsPlayedThisTurn).toBe(0);
    expect(after.players[after.currentPlayerIndex]?.id).toBe('p3');
    expect(Object.keys(after.statistics.players).sort()).toEqual(['p1', 'p3']);
  });

  it('shifts the turn marker correctly when someone before the current player is kicked', () => {
    const l = started();
    rig(l.room, (s) => { s.currentPlayerIndex = 2; });
    const after = l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(after.players[after.currentPlayerIndex]?.id).toBe('p3');
  });

  it('cannot be undone by the kicked player coming back: their old seat and token are gone', () => {
    const l = started();
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(() => l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-new', token, 'u2')).toThrow('Unable to rejoin game');
    expect(l.room().gameState.players.map((p) => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('who may kick', () => {
  it('only the host', () => {
    const l = started();
    expect(() => l.manager.kickPlayer('p2', { gameId: l.gameId, targetPlayerId: 'p3' })).toThrow('Only host can kick players');
    expect(l.room().gameState.players).toHaveLength(3);
  });

  it('not themselves, and not someone who is not in the game', () => {
    const l = started();
    expect(() => l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p1' })).toThrow('Cannot kick yourself');
    expect(() => l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'nobody' })).toThrow('Player not found in game');
  });

  it('not once the game is over', () => {
    const l = started();
    rig(l.room, (s) => { s.gamePhase = 'lost'; });
    expect(() => l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' })).toThrow('Cannot kick players after the game has ended');
  });

  it('also works in the lobby, where nobody has cards to return', () => {
    const l = table();
    const after = l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p3' });
    expect(after.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(after.drawPile).toHaveLength(0);
  });
});
