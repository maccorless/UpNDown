// Does the pair rule (see src/complement.ts) help the written strategy? Same validation deals, rule on against rule off.
//   npm run pairtest --workspace @upndown/engine -- --games 3000
import { chooseAction, compare, DEFAULT_WEIGHTS, playSet, seedsFor, STAGE_TABLES, summarize, tableById, type Policy } from '../src/index.js';

const i = process.argv.indexOf('--games');
const games = i >= 0 ? Number(process.argv[i + 1]) : 3000;
const off: Policy = (obs) => chooseAction(obs, { ...DEFAULT_WEIGHTS, deferComplement: false });
const on: Policy = (obs) => chooseAction(obs, DEFAULT_WEIGHTS);
for (const id of ['s3-solo-99-h7', 's3-2p-99-h7', 's3-4p-99-h7', 's3-solo-99-h11', 's2-solo-99-h9']) {
  if (!STAGE_TABLES.some((t) => t.id === id)) { console.log('no table', id); continue; }
  const table = tableById(id);
  const seeds = seedsFor('validation', games);
  const a = playSet(table, off, seeds);
  const b = playSet(table, on, seeds);
  const c = compare(b, a);
  console.log(id.padEnd(16), `off ${summarize(a).score.mean.toFixed(2)} (${(summarize(a).winRate * 100).toFixed(1)}%)  on ${summarize(b).score.mean.toFixed(2)} (${(summarize(b).winRate * 100).toFixed(1)}%)  diff ${c.score.mean >= 0 ? '+' : ''}${c.score.mean.toFixed(2)} (${c.score.low.toFixed(2)} to ${c.score.high.toFixed(2)})`);
}
