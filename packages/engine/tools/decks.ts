// Writes the shuffled decks of a seed set, so another program can replay exactly the games `sim eval` plays.
//   npm run decks --workspace @upndown/engine -- <out.json> <table> <set> <games>
import { writeFileSync } from 'node:fs';
import { buildDeck, seededRandom, seedsFor, shuffleWith, tableById, type SeedSet } from '../src/index.js';

const [out, table, set, games] = process.argv.slice(2);
if (!out || !table || !set || !games) throw new Error('Usage: decks <out.json> <table> <set> <games>');
const t = tableById(table);
const decks = seedsFor(set as SeedSet, Number(games)).map((seed) => shuffleWith(buildDeck(t.settings), seededRandom(seed)).map((c) => c.value));
writeFileSync(out, JSON.stringify({ table, set, decks }));
console.log(`wrote ${decks.length} decks of ${decks[0]!.length} cards to ${out}`);
