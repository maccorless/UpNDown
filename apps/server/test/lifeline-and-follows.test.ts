import { describe, expect, it } from 'vitest';
import { defaultMultiplayerSettings, specialOf } from '../src/game-manager.js';
import { lobbyWithUsers, rig } from './helpers/rig.js';

const undoSettings = { ...defaultMultiplayerSettings, allowUndo: true };

// p1 is on turn and holds a 31, which goes on the ascending pile at 30, and a 45 so the game is still on after that play
// (an empty hand with no play left would end it). p2 holds `p2Card`.
function playerOneCanGoOnPileZero(l: ReturnType<typeof lobbyWithUsers>, p2Card: number): void {
  rig(l.room, (state) => {
    state.currentPlayerIndex = state.players.findIndex((p) => p.id === 'p1');
    state.foundationPiles = [
      { id: 0, type: 'ascending', topCard: { id: 'f-0', value: 30 } },
      { id: 1, type: 'ascending', topCard: { id: 'f-1', value: 30 } },
      { id: 2, type: 'descending', topCard: { id: 'f-2', value: 60 } },
      { id: 3, type: 'descending', topCard: { id: 'f-3', value: 60 } }
    ];
    for (const p of state.players) p.hand = p.id === 'p1' ? [{ id: 'c-31', value: 31 }, { id: 'c-45', value: 45 }] : [{ id: 'c-held', value: p2Card }];
  });
}

describe('Called It on the server', () => {
  it('credits the person whose hand-placed mark was on the pile when a teammate played on it', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    playerOneCanGoOnPileZero(l, 5);
    l.manager.setReaction(l.gameId, 'p2', 0, 'like');
    l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-31', pileId: 0 });
    const stats = l.room().gameState.statistics.players;
    expect(stats.p2!.markFollows).toBe(1);
    expect(stats.p1!.markFollows).toBe(0);
  });

  it('takes the follow back when the teammate who played undoes it, so the credit cannot be farmed by playing and undoing', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }], undoSettings);
    l.manager.startGame('p1', l.gameId);
    playerOneCanGoOnPileZero(l, 5);
    l.manager.setReaction(l.gameId, 'p2', 0, 'like');
    l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-31', pileId: 0 });
    expect(l.room().gameState.statistics.players.p2!.markFollows).toBe(1);
    l.manager.undoLastPlay('p1', l.gameId);
    expect(l.room().gameState.statistics.players.p2!.markFollows).toBe(0);
  });

  it('gives nothing for an auto-marked pile, because an auto-mark is the switch doing the work, not the person', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    // A backward 10 on pile 0 is the strongest signal the server would send for a player, so auto-mark puts a mark there.
    playerOneCanGoOnPileZero(l, 20);
    rig(l.room, (state) => { state.players.find((p) => p.id === 'p2')!.autoMark = true; });
    l.manager.syncRobotReactions(l.gameId);
    expect(l.manager.getReactions(l.gameId).p2?.[0]).toBe('really_love');
    l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-31', pileId: 0 });
    expect(l.room().gameState.statistics.players.p2!.markFollows).toBe(0);
  });
});

describe('the flash on the board', () => {
  it('says Lifeline only when the backward 10 was the only play in the hand', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    rig(l.room, (state) => {
      state.currentPlayerIndex = state.players.findIndex((p) => p.id === 'p1');
      state.foundationPiles = [
        { id: 0, type: 'ascending', topCard: { id: 'f-0', value: 30 } },
        { id: 1, type: 'ascending', topCard: { id: 'f-1', value: 30 } },
        { id: 2, type: 'descending', topCard: { id: 'f-2', value: 20 } },
        { id: 3, type: 'descending', topCard: { id: 'f-3', value: 20 } }
      ];
      for (const p of state.players) p.hand = p.id === 'p1' ? [{ id: 'c-20', value: 20 }, { id: 'c-25', value: 25 }] : [];
    });
    const before = l.room().gameState;
    const after = l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-20', pileId: 0 });
    expect(specialOf(before, after, 'p1', 0)).toEqual({ pileId: 0, lifeline: true });
  });

  it('is an ordinary backward 10 when a normal play was still in the hand', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    playerOneCanGoOnPileZero(l, 5);
    rig(l.room, (state) => { state.players.find((p) => p.id === 'p1')!.hand = [{ id: 'c-20', value: 20 }, { id: 'c-31', value: 31 }]; });
    const before = l.room().gameState;
    const after = l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-20', pileId: 0 });
    expect(specialOf(before, after, 'p1', 0)).toEqual({ pileId: 0, lifeline: false });
  });

  it('is nothing at all for a play that is not a backward 10', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    playerOneCanGoOnPileZero(l, 5);
    const before = l.room().gameState;
    const after = l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-31', pileId: 0 });
    expect(specialOf(before, after, 'p1', 0)).toBeNull();
  });
});
