// Does the trained network treat a mark differently by how soon its sender plays? Plays games with the network, and at every decision compares the choice with no marks
// against the choice with ONE mark on the pile it would have played, from the next seat, the one after, and so on.
//   npx tsx tools/markprobe.ts [--games 200] [--level 3] [--table s3-4p-99-h7] [--model models/robot.json]
import { readFileSync } from 'node:fs';
import { buildDeck, buildNetInput, createStartedGameState, DEFAULT_SENDER, endTurn, honestBoard, loadNetwork, NET_END, networkLogits, playCard, seededRandom, seedsFor, shuffleWith, tableById, type NetworkWeights } from '../src/index.js';
import type { GameState } from '@upndown/shared-types';

const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : fallback; };
const games = Number(arg('games', '200'));
const level = Number(arg('level', '3'));
const table = tableById(arg('table', 's3-4p-99-h7'));
const net = loadNetwork(JSON.parse(readFileSync(new URL(`../${arg('model', 'models/robot.json')}`, import.meta.url), 'utf8')) as NetworkWeights);

function choose(state: GameState, marks: (idx: number) => number[] | null): { best: number; canon: number[]; logits: number[]; gap: number | null } {
  const input = buildNetInput(state, { tierB: net.tierB, reactionsOn: true, pairRule: net.pairRule, reactionsOf: marks, seatKindOf: () => 0 });
  const logits = networkLogits(net, input);
  let best = -1;
  for (let a = 0; a < input.mask.length; a += 1) if (input.mask[a] === 1 && (best < 0 || logits[a]! > logits[best]!)) best = a;
  return { best, canon: input.canon, logits: Array.from(logits), gap: null };
}

const LEVEL = { like: 1, love: 2, really_love: 3 } as const;
const seats = table.players - 1;
const stat = Array.from({ length: seats }, () => ({ n: 0, moved: 0, movedBig: 0, big: 0, drop: 0 }));
let decisions = 0;
for (const seed of seedsFor('validation', games)) {
  let state = createStartedGameState({
    gameId: 'PROBE', hostId: 'p1', players: Array.from({ length: table.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    settings: table.settings, isSolitaire: false, deck: shuffleWith(buildDeck(table.settings), seededRandom(seed))
  });
  for (let step = 0; step < 400 && state.gamePhase === 'playing'; step += 1) {
    const cur = state.currentPlayerIndex;
    const me = state.players[cur]!;
    const honest = honestBoard(state, DEFAULT_SENDER);
    const levels = (idx: number): number[] => [0, 1, 2, 3].map((id) => { const r = honest[state.players[idx]!.id]?.[id]; return r ? LEVEL[r] : 0; });
    const base = choose(state, levels);
    if (base.best < 0) break;
    // One seat's mark on one pile is the only thing that changes: first the honest board with that mark removed, then with it set to the chosen level.
    for (let k = 1; k <= seats; k += 1) {
      const seatIdx = (cur + k) % table.players;
      const without = (pileId: number) => (idx: number): number[] => (idx === seatIdx ? levels(idx).map((v, id) => (id === pileId ? 0 : v)) : levels(idx));
      const a = [0, 1, 2, 3].map((pileId) => ({ pileId, pick: choose(state, without(pileId)) }));
      for (const { pileId, pick } of a) {
        if (pick.best === NET_END || pick.canon[pick.best % 4] !== pileId) continue;
        const card = me.hand[Math.floor(pick.best / 4)]!;
        const pile = state.foundationPiles.find((p) => p.id === pileId)!;
        const backwardTen = pile.type === 'ascending' ? card.value === pile.topCard.value - 10 : card.value === pile.topCard.value + 10;
        if (backwardTen) continue;
        const stepSize = Math.abs(card.value - pile.topCard.value);
        const marked = choose(state, (idx) => (idx === seatIdx ? levels(idx).map((v, id) => (id === pileId ? level : v)) : levels(idx)));
        const s = stat[k - 1]!;
        s.n += 1;
        const movedOff = marked.best === NET_END || marked.canon[marked.best % 4] !== pileId;
        if (movedOff) s.moved += 1;
        if (stepSize > 2) { s.big += 1; if (movedOff) s.movedBig += 1; }
        s.drop += pick.logits[pick.best]! - marked.logits[pick.best]!;
      }
      if (k === 1) decisions += 1;
    }
    const action = base.best;
    state = action === NET_END ? endTurn(state, me.id) : playCard(state, me.id, me.hand[Math.floor(action / 4)]!.id, base.canon[action % 4]!);
  }
}
console.log(`${table.id}, ${games} games, ${decisions} decisions; for each pile the network would play (backward 10s left out) with one seat's mark removed, that seat's mark on it set to level ${level}`);
stat.forEach((s, i) => console.log(`seat ${i + 1} after the player on turn: stops playing that pile ${(100 * s.moved / s.n).toFixed(1)}% of ${s.n} cases, ${(100 * s.movedBig / Math.max(1, s.big)).toFixed(1)}% of ${s.big} when the step is more than 2; mean fall in the chosen move's score ${(s.drop / s.n).toFixed(3)}`));
