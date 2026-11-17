import { loadNetwork, type NetworkWeights } from '@upndown/engine';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { loadHintAdvisor, NetworkAdvisor } from '../src/robot-brain.js';
import { lobbyWithUsers, rig } from './helpers/rig.js';

const advisor = loadHintAdvisor()!;
const settings = { ...defaultMultiplayerSettings, maxPlayers: 4, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'unlimited' } as const };

function table(hintAdvisor: typeof advisor | null = advisor) {
  const manager = new GameManager({ hintAdvisor });
  const created = manager.createGame('h', { playerName: 'Hana', settings: { ...settings }, isSolitaire: false });
  manager.joinGame('g', { gameId: created.gameId, playerName: 'Guy' });
  manager.joinGame('k', { gameId: created.gameId, playerName: 'Kim' });
  manager.startGame('h', created.gameId);
  return { manager, gameId: created.gameId };
}

describe('hints with reasons', () => {
  it('is found in the repository', () => {
    expect(advisor).not.toBeNull();
  });

  it('gives a legal move with a headline and one to three reasons, on the asker\'s turn only', () => {
    const { manager, gameId } = table();
    const state = manager.peekState(gameId)!;
    const me = state.players[state.currentPlayerIndex]!;
    const other = state.players.find((p) => p.id !== me.id)!;
    expect(() => manager.hintAdvice(other.id, { gameId })).toThrow('own turn');
    const advice = manager.hintAdvice(me.id, { gameId });
    expect(advice.headline).toBeTruthy();
    expect(advice.reasons!.length).toBeGreaterThanOrEqual(1);
    expect(advice.reasons!.length).toBeLessThanOrEqual(3);
    if (advice.action.type === 'play') expect(me.hand.some((c) => c.id === (advice.action as { cardId: string }).cardId)).toBe(true);
  });

  // The hint must be something the player could have worked out: it may not depend on the draw pile order, other hands, or the played-card record.
  it('does not change when the hidden cards are shuffled (same sizes), so it never uses what the player cannot see', () => {
    for (let trial = 0; trial < 6; trial += 1) {
      const { manager, gameId } = table();
      const base = manager.peekState(gameId)!;
      const me = base.players[base.currentPlayerIndex]!.id;
      const reactions = manager.getReactions(gameId);
      const before = advisor.advise(base, me, reactions);
      const shuffled: GameState = structuredClone(base);
      // swap the other players' hands with the draw pile, keeping every count
      const pool = [...shuffled.drawPile, ...shuffled.players.filter((p) => p.id !== me).flatMap((p) => p.hand)].reverse();
      let at = 0;
      shuffled.drawPile = pool.slice(at, (at += shuffled.drawPile.length));
      for (const p of shuffled.players) if (p.id !== me) p.hand = pool.slice(at, (at += p.hand.length));
      expect(advisor.advise(shuffled, me, reactions)).toEqual(before);
    }
  });

  it('refuses a network that was given the played-card record', () => {
    const weights = JSON.parse(readFileSync(new URL('../../../packages/engine/models/robot.json', import.meta.url), 'utf8')) as NetworkWeights;
    expect(() => new NetworkAdvisor(loadNetwork(weights))).toThrow('played-card record');
  });

  it('falls back to the written strategy, with no reasons, when the advisor fails or there is none', () => {
    const failing = { advise: () => { throw new Error('boom'); } };
    for (const a of [failing, null]) {
      const { manager, gameId } = table(a);
      const state = manager.peekState(gameId)!;
      const advice = manager.hintAdvice(state.players[state.currentPlayerIndex]!.id, { gameId });
      expect(advice.reasons).toBeUndefined();
      expect(['play', 'endTurn', 'none']).toContain(advice.action.type);
    }
  });

  it('counts as a use, and the plain hint still returns just an action', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }, { id: 'g', name: 'Guy' }], { ...settings });
    l.manager.startGame('h', l.gameId);
    rig(l.room, () => undefined);
    const state = l.manager.peekState(l.gameId)!;
    const me = state.players[state.currentPlayerIndex]!.id;
    const action = l.manager.hint(me, { gameId: l.gameId });
    expect(action.type).toBeDefined();
    expect(l.manager.peekState(l.gameId)!.statistics.players[me]!.hintsUsed).toBe(1);
  });
});
