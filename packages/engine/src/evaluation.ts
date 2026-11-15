import type { SenderThresholds } from './reactions.js';
import { type StageTable } from './tables.js';
import { mcnemarPValue, mean, pairedInterval, standardDeviation, wilsonInterval, type Interval } from './stats.js';
import { playGameWith, scoreGame, type GameRecord, type Policy } from './simulate.js';

// Three seed sets that are never mixed (plan section 8). Training uses the first, choosing between methods and checkpoints
// uses the second, and the third is the test set: used for the numbers that are reported and for acceptance, and looked at
// once. A game's shuffle depends only on its seed, so two strategies given the same seeds play the same deals.
export type SeedSet = 'train' | 'validation' | 'test';
const SEED_BASE: Record<SeedSet, number> = { train: 1_000_000, validation: 5_000_000, test: 9_000_000 };
export const SEED_SET_SIZE = 1_000_000;

export function seedsFor(set: SeedSet, count: number, offset = 0): number[] {
  if (offset + count > SEED_SET_SIZE) throw new Error(`A seed set holds ${SEED_SET_SIZE} games`);
  return Array.from({ length: count }, (_, i) => SEED_BASE[set] + offset + i);
}

// The scorings reported side by side. `ken` is the one that is judged; the other two are checks that the choice of scoring
// does not change the story (they are functions of the same few numbers, not independent evidence).
export const SCORINGS: Record<'ken' | 'sharePlayed' | 'cardsLeft', (r: GameRecord) => number> = {
  ken: scoreGame,
  // The first version: a win is 100, a loss is 30 times the share played, halved if the draw pile was not emptied.
  sharePlayed: (r) => (r.outcome === 'won' ? 100 : 30 * ((r.cardsTotal - r.cardsLeft) / r.cardsTotal) * (r.drawLeft > 0 ? 0.5 : 1)),
  // No win bonus at all: just minus the cards left.
  cardsLeft: (r) => -r.cardsLeft
};

export interface EvaluationSummary {
  games: number;
  won: number;
  winRate: number;
  winInterval: [number, number];
  score: Interval;
  scoreSd: number;
  cardsLeft: number;
  stalled: number;
}

export function playSet(table: StageTable, policy: Policy, seeds: readonly number[], senders?: SenderThresholds, options: { record?: boolean } = {}): GameRecord[] {
  return seeds.map((seed) => playGameWith(table.settings, table.players, seed, policy, senders, options));
}

export function summarize(records: readonly GameRecord[]): EvaluationSummary {
  const won = records.filter((r) => r.outcome === 'won').length;
  const scores = records.map(scoreGame);
  return {
    games: records.length,
    won,
    winRate: won / Math.max(1, records.length),
    winInterval: wilsonInterval(won, records.length),
    score: pairedInterval(scores),
    scoreSd: standardDeviation(scores),
    cardsLeft: mean(records.map((r) => r.cardsLeft)),
    stalled: records.filter((r) => r.outcome === 'stalled').length
  };
}

export interface Comparison {
  games: number;
  // Paired differences, A minus B, in each scoring.
  score: Interval;
  sharePlayed: Interval;
  cardsLeft: Interval;
  winRateA: number;
  winRateB: number;
  // Games only A won and games only B won, and McNemar's two-sided p-value for the difference.
  onlyAWon: number;
  onlyBWon: number;
  pValue: number;
  // Standard deviation of a paired score difference (what sample sizes are chosen from).
  scoreDifferenceSd: number;
}

// A against B on the same deals. Everything is paired, so a difference is the strategies and not the luck of the cards.
export function compare(a: readonly GameRecord[], b: readonly GameRecord[]): Comparison {
  if (a.length !== b.length) throw new Error('Paired comparison needs the same games');
  const diff = (f: (r: GameRecord) => number): number[] => a.map((r, i) => f(r) - f(b[i]!));
  const scoreDiffs = diff(SCORINGS.ken);
  let onlyAWon = 0;
  let onlyBWon = 0;
  a.forEach((r, i) => {
    const aw = r.outcome === 'won';
    const bw = b[i]!.outcome === 'won';
    if (aw && !bw) onlyAWon += 1;
    if (!aw && bw) onlyBWon += 1;
  });
  return {
    games: a.length,
    score: pairedInterval(scoreDiffs),
    sharePlayed: pairedInterval(diff(SCORINGS.sharePlayed)),
    cardsLeft: pairedInterval(diff((r) => -r.cardsLeft)),
    winRateA: a.filter((r) => r.outcome === 'won').length / a.length,
    winRateB: b.filter((r) => r.outcome === 'won').length / b.length,
    onlyAWon,
    onlyBWon,
    pValue: mcnemarPValue(onlyAWon, onlyBWon),
    scoreDifferenceSd: standardDeviation(scoreDiffs)
  };
}
