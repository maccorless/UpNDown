// A local tool, never part of the server or the client: plays whole games with the strategy and searches for better weights.
// It uses no player data and makes no network calls. Run it with:
//   npm run sim --workspace @upndown/engine -- play  --setting table4 --games 500
//   npm run sim --workspace @upndown/engine -- train --setting table4 --rounds 30 --games 150 --seed 1
//   npm run sim --workspace @upndown/engine -- report
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { DEFAULT_WEIGHTS, playGame, scoreGame, seededRandom, type StrategyWeights } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(here, 'runs');

interface Setting { label: string; settings: GameSettings; players: number }

// The tables a strategy is judged on.
const SETTINGS: Record<string, Setting> = {
  solo: { label: 'solitaire, the default deck', settings: { ...defaultSolitaireSettings }, players: 1 },
  'solo-easy': { label: 'solitaire, easy (59 cards, hand of 8, one card a turn)', settings: { ...defaultSolitaireSettings, maxCardValue: 59, handSize: 8, minCardsPerTurn: 1 }, players: 1 },
  table2: { label: 'two players, the default deck', settings: { ...defaultMultiplayerSettings, autoRefillHand: false, handSize: 7, minCardsPerTurn: 2 }, players: 2 },
  table4: { label: 'four players, the default deck', settings: { ...defaultMultiplayerSettings, autoRefillHand: false, handSize: 7, minCardsPerTurn: 2 }, players: 4 }
};

export const reward = scoreGame;

const BOUNDS: Record<keyof StrategyWeights, [number, number]> = {
  gap: [0.2, 4], backwardTen: [0, 40], skipOver: [0, 20], strand: [0, 30], stopGap: [0, 12], planPlayed: [0, 10], planGap: [0, 2]
};
const KEYS = Object.keys(BOUNDS) as Array<keyof StrategyWeights>;

interface Score { reward: number; winRate: number; cardsLeft: number }

function evaluate(setting: Setting, weights: StrategyWeights, games: number, firstSeed: number): Score {
  let total = 0;
  let wins = 0;
  let left = 0;
  for (let i = 0; i < games; i += 1) {
    const record = playGame(setting.settings, setting.players, firstSeed + i, weights);
    total += reward(record);
    if (record.outcome === 'won') wins += 1;
    left += record.cardsLeft;
  }
  return { reward: total / games, winRate: wins / games, cardsLeft: left / games };
}

// Nudges some of the weights, within their bounds.
function mutate(weights: StrategyWeights, random: () => number, size: number): StrategyWeights {
  const out = { ...weights };
  for (const key of KEYS) {
    if (random() > 0.45) continue;
    const [low, high] = BOUNDS[key];
    const step = (random() * 2 - 1) * size * (high - low);
    const next = Math.min(high, Math.max(low, out[key] + step));
    out[key] = key === 'stopGap' ? Math.round(next) : Math.round(next * 100) / 100;
  }
  return out;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const show = (label: string, score: Score): string => `${label.padEnd(10)} reward ${score.reward.toFixed(2)}  won ${pct(score.winRate)}  cards left ${score.cardsLeft.toFixed(2)}`;

function settingFromArgs(): [string, Setting] {
  const name = arg('setting', 'table4');
  const setting = SETTINGS[name];
  if (!setting) throw new Error(`Unknown setting "${name}". Choose one of: ${Object.keys(SETTINGS).join(', ')}`);
  return [name, setting];
}

function play(): void {
  const [name, setting] = settingFromArgs();
  const games = Number(arg('games', '500'));
  const seed = Number(arg('seed', '1'));
  console.log(`${setting.label}: ${games} games from seed ${seed}`);
  console.log(show('weights', evaluate(setting, DEFAULT_WEIGHTS, games, seed)));
  void name;
}

// Hill climbing: each round tries several nudged copies of the best weights so far, on the same games as the best, and keeps
// the best copy only if it also does better on a second set of games. Simple, reproducible from its seed, and easy to explain; a learned policy is only worth
// trying if this stops improving.
function train(): void {
  const [name, setting] = settingFromArgs();
  const rounds = Number(arg('rounds', '30'));
  const games = Number(arg('games', '150'));
  const children = Number(arg('children', '6'));
  const seed = Number(arg('seed', '1'));
  const holdout = Number(arg('holdout', '600'));
  const margin = Number(arg('margin', '0.3'));
  const random = seededRandom(seed);
  let best: StrategyWeights = { ...DEFAULT_WEIGHTS };
  console.log(`training on ${setting.label}: ${rounds} rounds, ${children} candidates a round, ${games} games each, seed ${seed}`);
  for (let round = 0; round < rounds; round += 1) {
    // Every candidate in a round plays the same games, so a difference between them is the weights, not luck.
    const firstSeed = seed * 1_000 + round * games * 2;
    const bestScore = evaluate(setting, best, games, firstSeed);
    const size = 0.25 * (1 - round / rounds) + 0.04;
    let leader: { weights: StrategyWeights; score: Score } | null = null;
    for (let c = 0; c < children; c += 1) {
      const candidate = mutate(best, random, size);
      const score = evaluate(setting, candidate, games, firstSeed);
      if (score.reward > bestScore.reward && (!leader || score.reward > leader.score.reward)) leader = { weights: candidate, score };
    }
    // The best of several tries on the same games is partly luck (the winner's curse), which is how a first version of this
    // search "improved" its way to weights that did worse on fresh games. So the leader has to win again on games it was not
    // picked on, by a margin, before it replaces the current best.
    let improved = false;
    let shown = bestScore;
    if (leader) {
      const freshSeed = firstSeed + games;
      const fresh = evaluate(setting, leader.weights, games, freshSeed);
      const baseline = evaluate(setting, best, games, freshSeed);
      if (fresh.reward > baseline.reward + margin) { best = leader.weights; improved = true; shown = fresh; }
    }
    console.log(`round ${String(round + 1).padStart(3)}  ${show(improved ? 'improved' : 'kept', shown)}`);
  }
  // Judged on games it never trained on.
  const heldOut = 5_000_000;
  const before = evaluate(setting, DEFAULT_WEIGHTS, holdout, heldOut);
  const after = evaluate(setting, best, holdout, heldOut);
  console.log(`\nheld out: ${holdout} games the search never saw`);
  console.log(show('current', before));
  console.log(show('trained', after));
  console.log('trained weights:', JSON.stringify(best));
  mkdirSync(RUNS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RUNS, `${stamp}-${name}.json`);
  writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), setting: name, label: setting.label, seed, rounds, games, children, holdout, current: { weights: DEFAULT_WEIGHTS, ...before }, trained: { weights: best, ...after } }, null, 2)}\n`);
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

// A grid of simpler tables (smaller decks, bigger hands, no cheats), to see where the current strategy is neither beaten every
// time nor beating the game every time. Those are the tables worth training on.
function calibrate(): void {
  const games = Number(arg('games', '300'));
  const seed = Number(arg('seed', '1'));
  const rows: string[] = ['players  top card  hand  per turn  refill   won      reward  cards left'];
  for (const players of [1, 2, 4]) {
    for (const top of [29, 39, 49, 59, 79, 99]) {
      for (const hand of [7, 9, 11]) {
        const base = players === 1 ? defaultSolitaireSettings : defaultMultiplayerSettings;
        const minCardsPerTurn = 2;
        const settings: GameSettings = { ...base, maxCardValue: top, handSize: hand, minCardsPerTurn, autoRefillHand: players === 1, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' }, allowCardLookup: false };
        if (Math.floor((top - 1) / hand) < players) continue;
        const score = evaluate({ label: '', settings, players }, DEFAULT_WEIGHTS, games, seed);
        rows.push(`${String(players).padEnd(9)}${String(top).padEnd(10)}${String(hand).padEnd(6)}${String(minCardsPerTurn).padEnd(10)}${players === 1 ? 'yes   ' : 'no    '}   ${pct(score.winRate).padEnd(8)} ${score.reward.toFixed(1).padEnd(7)} ${score.cardsLeft.toFixed(1)}`);
      }
    }
  }
  console.log(rows.join('\n'));
}

function report(): void {
  let files: string[] = [];
  try { files = readdirSync(RUNS).filter((f) => f.endsWith('.json')).sort(); } catch { /* no runs yet */ }
  if (files.length === 0) { console.log('No runs saved yet. Run `train` first.'); return; }
  for (const file of files) {
    const run = JSON.parse(readFileSync(path.join(RUNS, file), 'utf8')) as { date: string; label: string; seed: number; holdout: number; current: Score; trained: Score & { weights: StrategyWeights } };
    console.log(`${run.date}  ${run.label}  (seed ${run.seed}, ${run.holdout} held-out games)`);
    console.log(`  ${show('current', run.current)}`);
    console.log(`  ${show('trained', run.trained)}`);
    console.log(`  weights ${JSON.stringify(run.trained.weights)}`);
  }
}

const command = process.argv[2];
if (command === 'play') play();
else if (command === 'train') train();
else if (command === 'report') report();
else if (command === 'calibrate') calibrate();
else console.log('Usage: sim <play|train|report|calibrate> [--setting solo|solo-easy|table2|table4] [--games N] [--rounds N] [--seed N]');
