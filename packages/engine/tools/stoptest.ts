// How big a move still counts as "tiny" once the turn's minimum is played? Tests rules that depend on how early the game is and on what teammates
// have marked on the pile, against a fixed threshold, with everyone showing honest reactions.
//   npm run stoptest --workspace @upndown/engine -- --table s3-4p-99-h7 --games 3000
import {
  compare, DEFAULT_SENDER, DEFAULT_WEIGHTS, highestAsk, playSet, rankPlays, receiverBias, seedsFor, summarize, tableById, type Action, type Observation, type Policy
} from '../src/index.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const table = tableById(arg('table', 's3-4p-99-h7'));
const games = Number(arg('games', '3000'));
const span = table.settings.maxCardValue - table.settings.minCardValue + 1;

// `pairBound`: also play on when a move of at most this many steps sets up a backward 10 from your own hand (the card is exactly 10 under it, or 10 over for a down pile), so the pair
// sets the pile back by 10 minus the step.
interface Rule { name: string; tiny: (share: number, mark: number) => number; pairBound?: number }
const marks = (none: number, like: number, love: number, really: number) => (_s: number, m: number): number => [none, like, love, really][m]!;
const rules: Rule[] = [
  { name: 'fixed 3 (the written strategy)', tiny: () => 3 },
  { name: 'marks: none 3, like 6, love 2, really love 0', tiny: marks(3, 6, 2, 0) },
  { name: 'marks: none 3, like 6, love 3, really love 0', tiny: marks(3, 6, 3, 0) },
  { name: 'marks: none 3, like 8, love 3, really love 0', tiny: marks(3, 8, 3, 0) },
  { name: 'marks: none 4, like 6, love 3, really love 0', tiny: marks(4, 6, 3, 0) },
  { name: 'marks: none 3, like 6, love 4, really love 0', tiny: marks(3, 6, 4, 0) },
  { name: 'marks: none 3, like 6, love 3, really love 1', tiny: marks(3, 6, 3, 1) },
  { name: 'marks 3/6/3/0, stage early +1 late -1', tiny: (s, m) => marks(3, 6, 3, 0)(s, m) + (m === 3 ? 0 : s > 0.6 ? 1 : s < 0.3 ? -1 : 0) }
];

// The written strategy's choice of what to play, with the rule above deciding whether to go on once the minimum is met.
const policyFor = (rule: Rule): Policy => (obs: Observation): Action => {
  if (!obs.myTurn) return { type: 'none' };
  const plays = rankPlays(obs, DEFAULT_WEIGHTS, obs.reactions ? receiverBias(obs) : undefined);
  const best = plays[0];
  const needed = Math.max(0, obs.required - obs.cardsPlayedThisTurn);
  if (!best) return obs.isSolitaire || needed > 0 ? { type: 'none' } : { type: 'endTurn' };
  if (obs.isSolitaire || needed > 0) return { type: 'play', cardId: best.cardId, pileId: best.pileId };
  if (rule.pairBound !== undefined) {
    const held = new Set(obs.hand.map((c) => c.value));
    const setup = plays.filter((p) => {
      if (p.backwardTen || p.gap > rule.pairBound!) return false;
      const card = obs.hand.find((c) => c.id === p.cardId)!;
      const pile = obs.piles.find((x) => x.id === p.pileId)!;
      return held.has(pile.type === 'ascending' ? card.value - 10 : card.value + 10);
    }).sort((a, b) => a.gap - b.gap)[0];
    if (setup) return { type: 'play', cardId: setup.cardId, pileId: setup.pileId };
  }
  const share = obs.drawCount / span;
  const tiny = rule.tiny(share, highestAsk(obs, best.pileId));
  return best.backwardTen || best.gap <= tiny ? { type: 'play', cardId: best.cardId, pileId: best.pileId } : { type: 'endTurn' };
};

const seeds = seedsFor('validation', games);
const base = playSet(table, policyFor(rules[0]!), seeds, DEFAULT_SENDER);
console.log(`${table.id}, ${games} validation games, honest reactions. Score (win rate); difference from the fixed 3 with a 95% interval.`);
for (const rule of rules) {
  const records = rule === rules[0] ? base : playSet(table, policyFor(rule), seeds, DEFAULT_SENDER);
  const s = summarize(records);
  const c = compare(records, base);
  const diff = rule === rules[0] ? '' : `  ${c.score.mean >= 0 ? '+' : ''}${c.score.mean.toFixed(2)} (${c.score.low.toFixed(2)} to ${c.score.high.toFixed(2)})`;
  console.log(`${s.score.mean.toFixed(2)} (${(s.winRate * 100).toFixed(1)}%)${diff}  ${rule.name}`);
}
