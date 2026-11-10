import { describe, expect, it } from 'vitest';
import { GameManager, defaultMultiplayerSettings } from '../src/game-manager.js';
import { toPlayerView } from '../src/player-view.js';

function startedGame() {
  const manager = new GameManager();
  const created = manager.createGame('host', { playerName: 'Host', settings: defaultMultiplayerSettings, isSolitaire: false });
  manager.joinGame('guest', { gameId: created.gameId, playerName: 'Guest' });
  return manager.startGame('host', created.gameId);
}

describe('toPlayerView', () => {
  it('shows a player their own hand but never another hand or the draw order (a client reads hidden cards straight off the socket otherwise)', () => {
    const state = startedGame();
    const view = toPlayerView(state, 'guest');

    const own = view.players.find((p) => p.id === 'guest')!;
    const other = view.players.find((p) => p.id === 'host')!;
    expect(own.hand).toEqual(state.players.find((p) => p.id === 'guest')!.hand);
    expect(other.hand.every((card) => card.value === 0)).toBe(true);
    expect(view.drawPile.every((card) => card.value === 0)).toBe(true);
  });

  it('keeps hand and draw pile counts, which the UI and the cards-per-turn rule depend on', () => {
    const state = startedGame();
    const view = toPlayerView(state, 'guest');

    expect(view.players.find((p) => p.id === 'host')!.hand.length).toBe(state.players.find((p) => p.id === 'host')!.hand.length);
    expect(view.drawPile.length).toBe(state.drawPile.length);
  });

  it('does not mutate the authoritative state', () => {
    const state = startedGame();
    const before = structuredClone(state);
    toPlayerView(state, 'guest');
    expect(state).toEqual(before);
  });

  it('gives a non-player no cards at all', () => {
    const view = toPlayerView(startedGame(), 'stranger');
    expect(view.players.every((p) => p.hand.every((card) => card.value === 0))).toBe(true);
  });
});
