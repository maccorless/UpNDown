import { describe, expect, it } from 'vitest';
import { senderLevel } from '@upndown/engine';
import { defaultMultiplayerSettings } from '../src/game-manager.js';
import { lobbyWithUsers, rig } from './helpers/rig.js';

const settings = { ...defaultMultiplayerSettings, allowUndo: true, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', automark: 'unlimited' } as const };

const started = () => {
  const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }], settings);
  const state = l.manager.startGame('p1', l.gameId);
  const onTurn = state.players[state.currentPlayerIndex]!.id;
  const other = state.players.find((p) => p.id !== onTurn)!.id;
  return { l, onTurn, other };
};

describe('auto-mark', () => {
  it('marks the piles for a person by the robots\' rule, which is the point of the cheat: the same marks a robot would show', () => {
    const { l, other } = started();
    expect(l.manager.syncRobotReactions(l.gameId)).toBe(false);
    // Give the off-turn player a card one step above pile 0's top card, so there is certainly a mark to show.
    rig(l.room, (s) => {
      const pile = s.foundationPiles[0]!;
      const card = s.players.find((p) => p.id === other)!.hand[0]!;
      card.value = pile.type === 'ascending' ? pile.topCard.value + 1 : pile.topCard.value - 1;
    });
    l.manager.setAutoMark(other, l.gameId, true);
    l.manager.syncRobotReactions(l.gameId);
    const state = l.room().gameState;
    const hand = state.players.find((p) => p.id === other)!.hand;
    const expected = Object.fromEntries(state.foundationPiles.flatMap((pile) => { const level = senderLevel(hand, pile, state.settings); return level ? [[pile.id, level]] : []; }));
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(l.manager.getReactions(l.gameId)[other]).toEqual(expected);
  });

  it('takes the marks down when it is turned off, so a stale ask does not stay on the table', () => {
    const { l, other } = started();
    l.manager.setAutoMark(other, l.gameId, true);
    l.manager.syncRobotReactions(l.gameId);
    l.manager.setAutoMark(other, l.gameId, false);
    expect(l.manager.getReactions(l.gameId)[other]).toBeUndefined();
    expect(l.manager.syncRobotReactions(l.gameId)).toBe(false);
  });

  it('shows nothing for a person on turn, as for a robot on turn', () => {
    const { l, onTurn } = started();
    l.manager.setAutoMark(onTurn, l.gameId, true);
    l.manager.syncRobotReactions(l.gameId);
    expect(l.manager.getReactions(l.gameId)[onTurn]).toBeUndefined();
  });

  it('is refused when the game has the cheat off', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }], { ...settings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' } });
    l.manager.startGame('p1', l.gameId);
    expect(() => l.manager.setAutoMark('p2', l.gameId, true)).toThrow('not enabled');
  });

  it('stays on after the player on turn undoes a play, because an undo takes back a play and not a setting', () => {
    const { l, onTurn, other } = started();
    const state = l.room().gameState;
    const hand = state.players.find((p) => p.id === onTurn)!.hand;
    let played = false;
    for (const c of hand) for (let pileId = 0; pileId < state.foundationPiles.length && !played; pileId += 1) {
      try { l.manager.playCard(onTurn, { gameId: l.gameId, cardId: c.id, pileId }); played = true; } catch { /* next */ }
    }
    expect(played).toBe(true);
    l.manager.setAutoMark(other, l.gameId, true);
    l.manager.undoLastPlay(onTurn, l.gameId);
    expect(l.room().gameState.players.find((p) => p.id === other)!.autoMark).toBe(true);
  });
});
