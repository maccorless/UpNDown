import { describe, expect, it } from 'vitest';
import { defaultMultiplayerSettings } from '../src/game-manager.js';
import { toPlayerView } from '../src/player-view.js';
import { lobbyWithUsers, rig, setUpWin } from './helpers/rig.js';

const undoSettings = { ...defaultMultiplayerSettings, allowUndo: true };

function playFirstLegal(l: ReturnType<typeof lobbyWithUsers>, activeId: string): void {
  const state = l.room().gameState;
  const hand = state.players.find((p) => p.id === activeId)!.hand;
  for (const c of hand) {
    for (let pileId = 0; pileId < state.foundationPiles.length; pileId += 1) {
      try { l.manager.playCard(activeId, { gameId: l.gameId, cardId: c.id, pileId }); return; } catch { /* try the next */ }
    }
  }
  throw new Error('no legal play found');
}

describe('profile counters on the server', () => {
  it('counts an undo for the player who took it, and still counts it after a second undo (stats were rolled back with the play otherwise)', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }], undoSettings);
    const started = l.manager.startGame('p1', l.gameId);
    const active = started.players[started.currentPlayerIndex]!.id;
    playFirstLegal(l, active);
    l.manager.undoLastPlay(active, l.gameId);
    expect(l.room().gameState.statistics.players[active]!.undosUsed).toBe(1);
    playFirstLegal(l, active);
    l.manager.undoLastPlay(active, l.gameId);
    expect(l.room().gameState.statistics.players[active]!.undosUsed).toBe(2);
  });

  it('counts a mark when one is placed and not when it is cleared', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    const started = l.manager.startGame('p1', l.gameId);
    const other = started.players.find((p) => p.id !== started.players[started.currentPlayerIndex]!.id)!.id;
    l.manager.setReaction(l.gameId, other, 0, 'like');
    l.manager.setReaction(l.gameId, other, 0, null);
    expect(l.room().gameState.statistics.players[other]!.marksPlaced).toBe(1);
  });

  it('records which player\'s play won, and keeps that after the winner reconnects under a new id (the seat is renamed, the credit must follow)', () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.startGame('p1', l.gameId);
    rig(l.room, (s) => setUpWin(s, 'p1'));
    const finished = l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-2', pileId: 0 });
    expect(finished.statistics.finishedById).toBe('p1');
    const token = l.manager.getRejoinToken(l.gameId, 'p1');
    const back = l.manager.rejoinPlayer(l.gameId, 'p1', 'p1-back', token, 'u1');
    expect(back.statistics.finishedById).toBe('p1-back');
  });
});

describe('the run id in the player view', () => {
  it('is present in the view (so a guest browser can name the game as the server does) and never stored in the room', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    const state = l.manager.startGame('p1', l.gameId);
    const runId = l.manager.runIdOf(l.gameId);
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(toPlayerView(state, 'p1', undefined, runId).runId).toBe(runId);
    expect(l.room().gameState.runId).toBeUndefined();
    expect(toPlayerView(state, 'p1').runId).toBeUndefined();
  });
});
