// A local tool, never part of the server or the client: plays whole games with the strategy and searches for better weights.
// It uses no player data and makes no network calls. Run it with:
//   npm run sim --workspace @upndown/engine -- play  --setting table4 --games 500
//   npm run sim --workspace @upndown/engine -- train --setting table4 --rounds 30 --games 150 --seed 1
//   npm run sim --workspace @upndown/engine -- report
//   npm run sim --workspace @upndown/engine -- tables
//   npm run sim --workspace @upndown/engine -- eval --table s3-4p-99-h7 --set validation --games 3000 [--reactions] [--record] [--dump file.json] [--weights '{...}'] [--against '{...}']
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { compare, DEFAULT_SENDER, DEFAULT_WEIGHTS, playGame, playSet, receiverPolicy, searchPolicy, scoreGame, seededRandom, seedsFor, STAGE_TABLES, summarize, tableById, weightedPolicy, type GameRecord, type SeedSet, type StrategyWeights } from '../src/index.js';

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

// The numbers a search can tune (the pair rule switch is not one of them).
type Tunable = Exclude<keyof StrategyWeights, 'deferComplement'>;
const BOUNDS: Record<Tunable, [number, number]> = {
  gap: [0.2, 4], backwardTen: [0, 40], skipOver: [0, 20], strand: [0, 30], stopGap: [0, 12], planPlayed: [0, 10], planGap: [0, 2]
};
const KEYS = Object.keys(BOUNDS) as Tunable[];

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

function tables(): void {
  for (const t of STAGE_TABLES) console.log(`stage ${t.stage}  ${t.id.padEnd(16)} ${t.label}`);
}

// Scores a strategy (and, with --against, compares it with another on the same deals). Use of the test set is logged: it is for once, at the end.
function evalCommand(): void {
  const table = tableById(arg('table', 's3-4p-99-h7'));
  const set = arg('set', 'validation') as SeedSet;
  if (!['train', 'validation', 'test'].includes(set)) throw new Error(`Unknown seed set ${set}`);
  const games = Number(arg('games', '1000'));
  const offset = Number(arg('offset', '0'));
  const weights = { ...DEFAULT_WEIGHTS, ...(JSON.parse(arg('weights', '{}')) as Partial<StrategyWeights>) };
  const seeds = seedsFor(set, games, offset);
  // --reactions: everyone shows honest reactions and the player on turn applies the hand-written receiver rule. Compared against no reactions by --against.
  const withReactions = process.argv.includes('--reactions');
  const record = process.argv.includes('--record');
  const a = withReactions ? playSet(table, receiverPolicy(weights), seeds, DEFAULT_SENDER, { record }) : playSet(table, weightedPolicy(weights), seeds, undefined, { record });
  const s = summarize(a);
  console.log(`${table.id} on ${set} games ${offset}..${offset + games - 1}: won ${pct(s.winRate)} (${pct(s.winInterval[0])} to ${pct(s.winInterval[1])}), score ${s.score.mean.toFixed(2)} (${s.score.low.toFixed(2)} to ${s.score.high.toFixed(2)}), sd ${s.scoreSd.toFixed(1)}, cards left ${s.cardsLeft.toFixed(2)}, stalled ${s.stalled}`);
  const dump = arg('dump', '');
  if (dump) writeFileSync(dump, JSON.stringify({ table: table.id, set, offset, scores: a.map((r) => scoreGame(r)), won: a.map((r) => r.outcome === 'won'), left: a.map((r) => r.cardsLeft) }));
  const against = arg('against', '');
  if (against) {
    const b = playSet(table, weightedPolicy({ ...DEFAULT_WEIGHTS, ...(JSON.parse(against) as Partial<StrategyWeights>) }), seeds);
    const c = compare(a, b);
    console.log(`  against: score ${c.score.mean >= 0 ? '+' : ''}${c.score.mean.toFixed(2)} (${c.score.low.toFixed(2)} to ${c.score.high.toFixed(2)}), cards left ${c.cardsLeft.mean.toFixed(2)}, only this won ${c.onlyAWon}, only other won ${c.onlyBWon}, p ${c.pValue.toPrecision(2)}`);
  }
  if (set === 'test') {
    mkdirSync(RUNS, { recursive: true });
    appendFileSync(path.join(RUNS, 'test-set-usage.log'), `${new Date().toISOString()}  ${table.id}  games ${offset}..${offset + games - 1}  weights ${JSON.stringify(weights)}\n`);
    console.log('  logged to runs/test-set-usage.log (the test set is for once, at the end)');
  }
}

// Search teacher against the strategy on the same deals (solitaire). Games are split over worker processes, which write their records as JSON.
//   npm run sim --workspace @upndown/engine -- search --table s2-solo-79-h7 --worlds 20 --games 200 [--record] [--margin 2] [--workers 16] [--set validation]
function searchOptions(): { table: ReturnType<typeof tableById>; set: SeedSet; seeds: number[]; worlds: number; record: boolean } {
  const table = tableById(arg('table', 's2-solo-79-h7'));
  if (table.players !== 1) throw new Error('The search teacher is solitaire only');
  const set = arg('set', 'validation') as SeedSet;
  return { table, set, seeds: seedsFor(set, Number(arg('games', '100')), Number(arg('offset', '0'))), worlds: Number(arg('worlds', '20')), record: process.argv.includes('--record') };
}

function searchChunk(): void {
  const o = searchOptions();
  const [index, count] = arg('chunk', '0/1').split('/').map(Number) as [number, number];
  const mine = o.seeds.filter((_, i) => i % count === index);
  console.log(JSON.stringify(playSet(o.table, searchPolicy({ settings: o.table.settings, worlds: o.worlds, margin: Number(arg('margin', '2')) }), mine, undefined, { record: o.record })));
}

async function searchCommand(): Promise<void> {
  const o = searchOptions();
  const workers = Number(arg('workers', '16'));
  const started = Date.now();
  const passthrough = process.argv.slice(3).filter((a, i, all) => a !== '--workers' && all[i - 1] !== '--workers');
  const parts = await Promise.all(Array.from({ length: workers }, (_, i) => new Promise<GameRecord[]>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, 'search-chunk', ...passthrough, '--chunk', `${i}/${workers}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as GameRecord[]) : reject(new Error(`worker ${i} exited with ${code}`))));
  })));
  // Put the records back in seed order so they pair with the strategy's.
  const records: GameRecord[] = new Array<GameRecord>(o.seeds.length);
  parts.forEach((part, i) => part.forEach((r, j) => { records[i + j * workers] = r; }));
  const seconds = (Date.now() - started) / 1000;
  const base = playSet(o.table, weightedPolicy(), o.seeds);
  const s = summarize(records);
  const b = summarize(base);
  const c = compare(records, base);
  console.log(`${o.table.id}, ${o.worlds} worlds, ${o.record ? 'Tier B (played-card record)' : 'Tier A (screen only)'}, ${o.seeds.length} ${o.set} games, ${seconds.toFixed(0)} s on ${workers} workers`);
  console.log(`  strategy: won ${pct(b.winRate)}, score ${b.score.mean.toFixed(2)}, cards left ${b.cardsLeft.toFixed(2)}`);
  console.log(`  search:   won ${pct(s.winRate)}, score ${s.score.mean.toFixed(2)}, cards left ${s.cardsLeft.toFixed(2)}, stalled ${s.stalled}`);
  console.log(`  paired:   score ${c.score.mean >= 0 ? '+' : ''}${c.score.mean.toFixed(2)} (${c.score.low.toFixed(2)} to ${c.score.high.toFixed(2)}), only search won ${c.onlyAWon}, only strategy won ${c.onlyBWon}, p ${c.pValue.toPrecision(2)}`);
}

const command = process.argv[2];
if (command === 'play') play();
else if (command === 'train') train();
else if (command === 'report') report();
else if (command === 'calibrate') calibrate();
else if (command === 'tables') tables();
else if (command === 'eval') evalCommand();
else if (command === 'search') void searchCommand();
else if (command === 'search-chunk') searchChunk();
else console.log('Usage: sim <play|train|report|calibrate|tables|eval|search> [--setting solo|solo-easy|table2|table4] [--games N] [--rounds N] [--seed N]');
