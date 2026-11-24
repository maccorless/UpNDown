import { defaultMultiplayerSettings, normalSolitaireSettings, deckFitMessage, gameSettingsSchema, deckSizeOf } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/init.js';
import { compare, playSet, SCORINGS, seedsFor, summarize } from '../src/evaluation.js';
import { playGame, playGameWith, scoreGame, seededRandom, shuffleWith, weightedPolicy, type GameRecord } from '../src/simulate.js';
import { chooseAction, DEFAULT_WEIGHTS, observe } from '../src/strategy.js';
import { REAL_TABLES, STAGE_TABLES, tableById } from '../src/tables.js';
import { createStartedGameState, endTurn, playCard, skipTurn, tradeCard } from '../src/transitions.js';
import type { GameState } from '@upndown/shared-types';

describe('the stage tables', () => {
  it('are the three stages of the plan: 3 easy, 7 medium and the 3 real defaults', () => {
    expect(STAGE_TABLES.filter((t) => t.stage === 1)).toHaveLength(3);
    expect(STAGE_TABLES.filter((t) => t.stage === 2)).toHaveLength(7);
    expect(STAGE_TABLES.filter((t) => t.stage === 3)).toHaveLength(3);
    expect(new Set(STAGE_TABLES.map((t) => t.id)).size).toBe(STAGE_TABLES.length);
  });

  it('are valid settings that can deal every player a full hand', () => {
    for (const t of STAGE_TABLES) {
      expect(gameSettingsSchema.safeParse(t.settings).success, t.id).toBe(true);
      expect(deckFitMessage(t.settings), t.id).toBeNull();
      expect(t.players * t.settings.handSize, t.id).toBeLessThanOrEqual(deckSizeOf(t.settings));
    }
  });

  it('have no cheats, no undo and no card seeker on any table', () => {
    for (const t of STAGE_TABLES) {
      expect(t.settings.cheatLimits, t.id).toEqual({ lookup: 'off', skip: 'off', trade: 'off', hint: 'off' });
      expect(t.settings.allowUndo, t.id).toBe(false);
      expect(t.settings.allowCardLookup, t.id).toBe(false);
    }
  });

  it('make stage 3 the Normal solitaire preset and the shipped multiplayer defaults, with solitaire refilling and tables not', () => {
    for (const t of REAL_TABLES) {
      const shipped = t.players === 1 ? normalSolitaireSettings : defaultMultiplayerSettings;
      expect(t.settings.maxCardValue, t.id).toBe(shipped.maxCardValue);
      expect(t.settings.minCardValue, t.id).toBe(shipped.minCardValue);
      expect(t.settings.handSize, t.id).toBe(shipped.handSize);
      expect(t.settings.minCardsPerTurn, t.id).toBe(shipped.minCardsPerTurn);
      expect(t.settings.autoRefillHand, t.id).toBe(t.players === 1);
    }
    expect(tableById('s3-4p-99-h7').players).toBe(4);
    expect(() => tableById('nope')).toThrow('No table');
  });
});

describe('seed sets', () => {
  it('never overlap, so training, validation and test games are different games', () => {
    const train = new Set(seedsFor('train', 1000));
    const validation = seedsFor('validation', 1000);
    const test = seedsFor('test', 1000);
    expect(validation.some((s) => train.has(s))).toBe(false);
    expect(test.some((s) => train.has(s) || validation.includes(s))).toBe(false);
  });

  it('give the same seeds every time, and can continue where they left off', () => {
    expect(seedsFor('test', 3)).toEqual(seedsFor('test', 3));
    expect(seedsFor('test', 2, 5)).toEqual(seedsFor('test', 7).slice(5));
  });

  it('refuse to run past the end of a set', () => {
    expect(() => seedsFor('validation', 10, 999_995)).toThrow('seed set');
  });
});

describe('paired comparison', () => {
  const table = tableById('s2-4p-79-h7');
  const seeds = seedsFor('validation', 60);

  it('deals the same cards to both strategies, whatever they do with them', () => {
    const a = playGameWith(table.settings, table.players, seeds[0]!, weightedPolicy(DEFAULT_WEIGHTS));
    const b = playGameWith(table.settings, table.players, seeds[0]!, weightedPolicy({ ...DEFAULT_WEIGHTS, gap: 0.2 }));
    expect(a.cardsTotal).toBe(b.cardsTotal);
    const deal = (seed: number): string => shuffleWith(buildDeck(table.settings), seededRandom(seed)).map((c) => c.id).join();
    expect(deal(seeds[0]!)).toBe(deal(seeds[0]!));
  });

  it('finds no difference between a strategy and itself, with every difference exactly zero', () => {
    const records = playSet(table, weightedPolicy(), seeds);
    const same = compare(records, records);
    expect(same.score).toEqual({ mean: 0, low: 0, high: 0 });
    expect(same.onlyAWon + same.onlyBWon).toBe(0);
    expect(same.pValue).toBe(1);
  });

  it('is antisymmetric: swapping A and B flips the sign of every difference', () => {
    const good = playSet(table, weightedPolicy(), seeds);
    const poor = playSet(table, weightedPolicy({ ...DEFAULT_WEIGHTS, gap: 0.2, stopGap: 12 }), seeds);
    const ab = compare(good, poor);
    const ba = compare(poor, good);
    expect(ab.score.mean).toBeCloseTo(-ba.score.mean, 10);
    expect(ab.onlyAWon).toBe(ba.onlyBWon);
    expect(ab.pValue).toBeCloseTo(ba.pValue, 10);
    expect(ab.score.mean).toBeGreaterThan(0);
  });

  it('summarizes win rate with an interval that contains it, and counts stalled games', () => {
    const summary = summarize(playSet(table, weightedPolicy(), seeds));
    expect(summary.winInterval[0]).toBeLessThanOrEqual(summary.winRate);
    expect(summary.winInterval[1]).toBeGreaterThanOrEqual(summary.winRate);
    expect(summary.stalled).toBe(0);
    expect(summary.games).toBe(60);
  });

  it('rejects comparing different games', () => {
    const records = playSet(table, weightedPolicy(), seeds);
    expect(() => compare(records, records.slice(1))).toThrow('same games');
  });
});

describe('the three scorings', () => {
  const record = (over: Partial<GameRecord>): GameRecord => ({ outcome: 'lost', cardsLeft: 5, drawLeft: 0, cardsTotal: 98, turns: 1, steps: 1, ...over });

  it('agree that a win is best and fewer cards left is better, so the choice does not change a ranking', () => {
    for (const [name, score] of Object.entries(SCORINGS)) {
      expect(score(record({ outcome: 'won', cardsLeft: 0 })), name).toBeGreaterThan(score(record({ cardsLeft: 1 })));
      expect(score(record({ cardsLeft: 2 })), name).toBeGreaterThan(score(record({ cardsLeft: 9 })));
    }
  });

  it('keeps the chosen scoring as the first, and the old flat scoring halving an unemptied draw pile', () => {
    expect(SCORINGS.ken).toBe(scoreGame);
    expect(SCORINGS.sharePlayed(record({ cardsLeft: 10, drawLeft: 3 }))).toBeCloseTo(0.5 * 30 * (88 / 98), 10);
  });
});

// The checks the plan said P0 must make rather than trust.
describe('the assumptions the learning reward rests on', () => {
  it('has a win always leave no card in a hand or in the draw pile, on every table', () => {
    for (const t of STAGE_TABLES) {
      let wins = 0;
      for (const seed of seedsFor('train', 150)) {
        const r = playGame(t.settings, t.players, seed);
        if (r.outcome === 'won') {
          wins += 1;
          expect(r.cardsLeft, `${t.id} seed ${seed}`).toBe(0);
          expect(r.drawLeft, `${t.id} seed ${seed}`).toBe(0);
        }
      }
      // The tables where wins are common must actually exercise the check.
      if (t.stage === 1) expect(wins, t.id).toBeGreaterThan(50);
    }
  });

  it('has a loss always leave at least one card in a hand, so the loss score formula applies', () => {
    for (const t of STAGE_TABLES.filter((x) => x.stage !== 1)) {
      for (const seed of seedsFor('train', 100)) {
        const r = playGame(t.settings, t.players, seed);
        if (r.outcome === 'lost') expect(r.cardsLeft - r.drawLeft, `${t.id} seed ${seed}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  // R = 100 for a win, 91 - H - 2D for a loss; dense reward = change in Phi = -(H + 2D) per step, plus 100 or 91 at the end.
  it('has the per-step reward add up to the game score, up to a constant that is the same for every game on a table', () => {
    const phi = (s: GameState): number => -(s.players.reduce((n, p) => n + p.hand.length, 0) + 2 * s.drawPile.length);
    for (const t of STAGE_TABLES.filter((x) => x.id.includes('79') || x.stage === 3)) {
      for (const seed of seedsFor('train', 25)) {
        const random = seededRandom(seed);
        let state = createStartedGameState({
          gameId: 'DENSE1', hostId: 'p1', players: Array.from({ length: t.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
          settings: t.settings, isSolitaire: t.players === 1, deck: shuffleWith(buildDeck(t.settings), random)
        });
        const phi0 = phi(state);
        let dense = 0;
        for (let step = 0; step < 5000 && state.gamePhase === 'playing'; step += 1) {
          const id = state.players[state.currentPlayerIndex]!.id;
          const action = chooseAction(observe(state, id));
          const before = phi(state);
          if (action.type === 'play') state = playCard(state, id, action.cardId, action.pileId);
          else if (action.type === 'endTurn') state = endTurn(state, id);
          else if (action.type === 'skip') state = skipTurn(state, id);
          else if (action.type === 'trade') state = tradeCard(state, id, action.cardId, random);
          else break;
          dense += phi(state) - before;
        }
        if (state.gamePhase === 'playing') continue;
        const won = state.gamePhase === 'won';
        const total = dense + (won ? 100 : 91);
        const left = state.players.reduce((n, p) => n + p.hand.length, 0);
        const score = won ? 100 : 91 - left - 2 * state.drawPile.length;
        expect(total + phi0, `${t.id} seed ${seed}`).toBe(score);
      }
    }
  });
});
