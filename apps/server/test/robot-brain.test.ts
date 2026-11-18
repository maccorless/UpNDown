import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeck, chooseAction, createStartedGameState, endTurn, observe, playCard, scoreGame, seededRandom, senderLevel, shuffleWith } from '@upndown/engine';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { loadRobotBrain, networkFits, type RobotBrain } from '../src/robot-brain.js';
import { lobbyWithUsers } from './helpers/rig.js';

const brain = loadRobotBrain()!;
const settings = { ...defaultMultiplayerSettings, maxPlayers: 6, autoRefillHand: false };
const start = (players: number, seed: number, over: Partial<typeof settings> = {}): GameState => {
  const s = { ...settings, ...over };
  return createStartedGameState({
    gameId: 'BRAIN1', hostId: 'p1', players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, ...(i > 0 ? { robot: true } : {}) })),
    settings: s, isSolitaire: false, deck: shuffleWith(buildDeck(s), seededRandom(seed))
  });
};

// Plays a whole table with the given decision function for every seat and returns the game's score.
function playOut(state0: GameState, decide: (s: GameState, id: string) => ReturnType<typeof chooseAction>): number {
  let state = state0;
  for (let step = 0; step < 4000 && state.gamePhase === 'playing'; step += 1) {
    const id = state.players[state.currentPlayerIndex]!.id;
    const a = decide(state, id);
    if (a.type === 'play') state = playCard(state, id, a.cardId, a.pileId);
    else if (a.type === 'endTurn') state = endTurn(state, id);
    else throw new Error(`Unexpected action ${a.type}`);
  }
  const left = state.drawPile.length + state.players.reduce((n, p) => n + p.hand.length, 0);
  return scoreGame({ outcome: state.gamePhase === 'won' ? 'won' : 'lost', cardsLeft: left, drawLeft: state.drawPile.length, cardsTotal: 0, turns: 0, steps: 0 });
}

describe('the robot brain', () => {
  it('is found in the repository and can be switched off', () => {
    expect(brain).not.toBeNull();
    expect(loadRobotBrain({ ROBOT_BRAIN: 'heuristic' })).toBeNull();
    expect(loadRobotBrain({ ROBOT_MODEL_PATH: path.join(path.dirname(fileURLToPath(import.meta.url)), 'nope.json') })).not.toBeNull(); // missing path: the bundled one is still found
  });

  it('only decides for tables the network was built for', () => {
    expect(networkFits(start(4, 1))).toBe(true);
    expect(networkFits(start(6, 1))).toBe(true);
    expect(networkFits({ ...start(2, 1), isSolitaire: true })).toBe(false);
    expect(networkFits(start(2, 1, { handSize: 12 }))).toBe(false);
    expect(networkFits(start(2, 1, { maxCardValue: 120 }))).toBe(false);
  });

  it('always names a move the rules accept, over whole games at several table sizes', () => {
    for (const players of [2, 3, 4, 6]) {
      for (const seed of [1, 2, 3]) {
        playOut(start(players, seed), (s, id) => brain.choose(s, id, {}) ?? chooseAction(observe(s, id)));
      }
    }
  });

  it('decides nothing out of turn, and nothing for a solitaire game', () => {
    const s = start(3, 4);
    expect(brain.choose(s, 'p3', {})).toBeNull();
    expect(brain.choose({ ...s, isSolitaire: true }, 'p1', {})).toBeNull();
  });

  // The reason robots use it at all: it plays better than the written strategy. This table (no auto refill, no reactions) is not one the network was trained on, and the
  // written strategy now follows the pair rule (+6.8 at two players, +2.2 at four, on the real tables), which this network has not learned. So the check here is only that
  // the network is still within a few points of the strategy over 24 deals; the real comparison is the 3,000 paired validation games in docs/plans.
  it('plays about as well as the written strategy over the same deals, at two and four players', () => {
    for (const players of [2, 4]) {
      let network = 0, written = 0;
      const games = 24;
      for (let seed = 1; seed <= games; seed += 1) {
        network += playOut(start(players, 100 + seed), (s, id) => brain.choose(s, id, {}) ?? chooseAction(observe(s, id)));
        written += playOut(start(players, 100 + seed), (s, id) => chooseAction(observe(s, id)));
      }
      expect(network / games, `${players} players`).toBeGreaterThan(written / games - 3);
    }
  });

  it('reads reactions: a teammate marking a pile changes what it does on some positions', () => {
    let changed = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const s = start(2, 300 + seed);
      const plain = brain.choose(s, 'p1', {});
      const loud = brain.choose(s, 'p1', { p2: { 0: 'really_love', 1: 'really_love', 2: 'really_love', 3: 'really_love' } });
      if (JSON.stringify(plain) !== JSON.stringify(loud)) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('robots at a table (reactions and fallback)', () => {
  const table = (robotBrain?: RobotBrain | null) => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }]);
    const manager = new GameManager({ robotBrain });
    void manager;
    return l;
  };

  it('shows honest reactions for robots not on turn, none for the robot on turn, and updates them when the piles move', () => {
    const l = table();
    l.manager.addRobot('h', l.gameId);
    l.manager.addRobot('h', l.gameId);
    const state = l.manager.startGame('h', l.gameId);
    expect(l.manager.syncRobotReactions(l.gameId)).toBe(state.players.some((p) => p.robot && state.players[state.currentPlayerIndex]!.id !== p.id && state.foundationPiles.some((pile) => senderLevel(p.hand, pile, state.settings) !== null)));
    const board = l.manager.getReactions(l.gameId);
    const onTurn = state.players[state.currentPlayerIndex]!.id;
    for (const p of state.players) {
      if (!p.robot) { expect(board[p.id]).toBeUndefined(); continue; }
      if (p.id === onTurn) { expect(board[p.id]).toBeUndefined(); continue; }
      for (const pile of state.foundationPiles) expect(board[p.id]?.[pile.id]).toBe(senderLevel(p.hand, pile, state.settings) ?? undefined);
    }
    expect(l.manager.syncRobotReactions(l.gameId)).toBe(false); // nothing moved, nothing changed
  });

  it('is silent before a game starts', () => {
    const l = table();
    expect(l.manager.syncRobotReactions(l.gameId)).toBe(false);
  });
});
