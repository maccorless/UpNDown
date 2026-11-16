// The training actor: plays E games in lockstep for the Python learner, over stdin and stdout. It holds the one copy of the rules (the
// engine), so what the learner trains on is exactly what the game does. Run by tools/training, never by the game.
//
//   tsx tools/actor.ts --tables id1,id2 --games 1024 --set train --worker 0 --workers 12 [--record] [--reactions]
//
// Each round the actor writes one record per game, in game order, then reads one little-endian int16 action per game. The record is
// the layout below (no padding). A finished game is reported in the record of the next round together with the first position of
// the game that replaced it (automatic reset), so the learner never sees a finished position.
//
// Action codes: card slot * 4 + canonical pile (0 and 1 are the ascending piles, lowest top first; 2 and 3 are the descending piles,
// highest top first), or 44 to end the turn. The slot is the card's place in the hand array sent in this record.
import {
  buildDeck, createStartedGameState, DEFAULT_SENDER, endTurn, honestBoard, isValidPlay, playCard, playedValues, seededRandom, seedsFor, shuffleWith, tableById
} from '../src/index.js';
import type { FoundationPile, GameState } from '@upndown/shared-types';

export const HAND = 11, OTHERS = 5, DECK = 100, ACTIONS = HAND * 4 + 1, END = HAND * 4;
// Header: seed index of the game that finished (-1 if none), outcome (0 none, 1 won, 2 lost), cards left, draw pile left, table index
// of the finished game, reward for the last action, done flag; then the position: hand, canonical pile tops, globals, other hand sizes
// (from the player's left), reactions of those seats on the four canonical piles, which of those seats are human-like (1) or robots (0), played-card record by value (Tier B, else zeros),
// the other seats' hands by seat (privileged, for the critic), the draw pile as a set by value (privileged), and the action mask.
export const GLOBALS = ['players', 'handSize', 'lo', 'hi', 'perTurn', 'refill', 'drawCount', 'playedThisTurn', 'required', 'solitaire', 'tierB', 'reactionsOn'] as const;
const HEADER = 4 + 1 + 2 + 2 + 1 + 4 + 1;
const OBS = HAND + 4 + GLOBALS.length + OTHERS + OTHERS * 4 + OTHERS + DECK + OTHERS * HAND + DECK;
export const RECORD_BYTES = HEADER + OBS + ACTIONS;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const E = Number(arg('games', '256'));
const tables = arg('tables', 's3-4p-99-h7').split(',').map(tableById);
const worker = Number(arg('worker', '0'));
const workers = Number(arg('workers', '1'));
const set = arg('set', 'train') as 'train' | 'validation' | 'test';
const record = process.argv.includes('--record');
const reactions = process.argv.includes('--reactions');
// --lag k: the reactions a player sees are the ones shown k plays ago (people do not update instantly).
const lag = Number(arg('lag', '0'));
// --seat-mix p: each seat of a new game is a robot (instant, exact reactions) with probability p, otherwise human-like: reactions 1 or 3 plays old, or never shown.
const seatMix = process.argv.includes('--seat-mix') ? Number(arg('seat-mix', '1')) : null;
const HUMAN_LAGS = [1, 3, -1];
const stride = workers * E;
const seedPool = seedsFor(set, 1_000_000);

interface Slot { state: GameState; table: number; seedIndex: number; canon: number[]; cursor: number; history: number[][][]; lags: number[] }
const phi = (s: GameState): number => -(s.players.reduce((n, p) => n + p.hand.length, 0) + 2 * s.drawPile.length);

function start(tableIndex: number, seedIndex: number): GameState {
  const t = tables[tableIndex]!;
  // Training reuses its deals once it has been through all of them (the policy plays them differently each time); a fixed evaluation set must never wrap.
  if (seedIndex >= seedPool.length && set !== 'train') throw new Error('Ran out of seeds');
  const seed = seedPool[seedIndex % seedPool.length]!;
  return createStartedGameState({
    gameId: 'ACTOR', hostId: 'p1', players: Array.from({ length: t.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    settings: t.settings, isSolitaire: t.players === 1, deck: shuffleWith(buildDeck(t.settings), seededRandom(seed))
  });
}

// Per seat: 0 for exact and instant (or the fixed --lag), a positive number of plays for a stale view, -1 for never shown.
function seatLags(tableIndex: number, seedIndex: number): number[] {
  const players = tables[tableIndex]!.players;
  if (seatMix === null) return new Array<number>(players).fill(lag);
  const pick = seededRandom((seedPool[seedIndex % seedPool.length]! ^ 0x5bd1e995) >>> 0);
  return Array.from({ length: players }, () => (pick() < seatMix ? 0 : HUMAN_LAGS[Math.floor(pick() * HUMAN_LAGS.length)]!));
}

const slots: Slot[] = Array.from({ length: E }, (_, e) => {
  const seedIndex = worker * E + e;
  const table = e % tables.length;
  return { state: start(table, seedIndex), table, seedIndex, canon: [0, 1, 2, 3], cursor: seedIndex, history: [], lags: seatLags(table, seedIndex) };
});
const out = Buffer.alloc(E * RECORD_BYTES);
const finished: Array<{ seed: number; outcome: number; left: number; draw: number; table: number } | null> = new Array(E).fill(null);
const lastReward = new Float32Array(E);
const lastDone = new Uint8Array(E);

function canonicalPiles(piles: readonly FoundationPile[]): number[] {
  const asc = piles.filter((p) => p.type === 'ascending').sort((a, b) => a.topCard.value - b.topCard.value || a.id - b.id).map((p) => p.id);
  const desc = piles.filter((p) => p.type === 'descending').sort((a, b) => b.topCard.value - a.topCard.value || a.id - b.id).map((p) => p.id);
  return [...asc, ...desc];
}

function writeRecord(e: number): void {
  const slot = slots[e]!;
  const s = slot.state;
  const t = tables[slot.table]!;
  const base = e * RECORD_BYTES;
  const f = finished[e];
  out.writeInt32LE(f ? f.seed : -1, base);
  out.writeUInt8(f ? f.outcome : 0, base + 4);
  out.writeInt16LE(f ? f.left : 0, base + 5);
  out.writeInt16LE(f ? f.draw : 0, base + 7);
  out.writeUInt8(f ? f.table : 0, base + 9);
  out.writeFloatLE(lastReward[e]!, base + 10);
  out.writeUInt8(lastDone[e]!, base + 14);
  let at = base + HEADER;
  out.fill(0, at, base + RECORD_BYTES);
  const me = s.players[s.currentPlayerIndex]!;
  const set8 = (index: number, v: number): void => { out.writeInt8(v, at + index); };
  me.hand.slice(0, HAND).forEach((c, i) => set8(i, c.value));
  at += HAND;
  slot.canon = canonicalPiles(s.foundationPiles);
  slot.canon.forEach((id, i) => set8(i, s.foundationPiles.find((p) => p.id === id)!.topCard.value));
  at += 4;
  const draw = s.drawPile.length;
  const required = draw === 0 ? 1 : t.settings.minCardsPerTurn;
  [t.players, t.settings.handSize, t.settings.minCardValue, t.settings.maxCardValue, t.settings.minCardsPerTurn, t.settings.autoRefillHand ? 1 : 0,
    draw, s.cardsPlayedThisTurn, required, t.players === 1 ? 1 : 0, record ? 1 : 0, reactions ? 1 : 0].forEach((v, i) => set8(i, v));
  at += GLOBALS.length;
  const others: number[] = [];
  for (let k = 1; k < t.players; k += 1) others.push((s.currentPlayerIndex + k) % t.players);
  others.forEach((idx, k) => set8(k, s.players[idx]!.hand.length));
  at += OTHERS;
  if (reactions && t.players > 1) {
    const board = honestBoard(s, DEFAULT_SENDER);
    const level = { like: 1, love: 2, really_love: 3 } as const;
    // the board as it stands, by seat and real pile id
    const now = s.players.map((p) => [0, 1, 2, 3].map((pileId) => { const r = board[p.id]?.[pileId]; return r ? level[r] : 0; }));
    slot.history.push(now);
    if (slot.history.length > 4) slot.history.shift();
    others.forEach((idx, k) => {
      const l = slot.lags[idx]!;
      if (l < 0) return;
      const seen = slot.history[Math.max(0, slot.history.length - 1 - l)]![idx]!;
      slot.canon.forEach((pileId, c) => set8(k * 4 + c, seen[pileId]!));
    });
  }
  at += OTHERS * 4;
  others.forEach((idx, k) => set8(k, slot.lags[idx] !== 0 ? 1 : 0));
  at += OTHERS;
  if (record) for (const v of playedValues(s)) set8(v, 1);
  at += DECK;
  others.forEach((idx, k) => s.players[idx]!.hand.slice(0, HAND).forEach((c, i) => set8(k * HAND + i, c.value)));
  at += OTHERS * HAND;
  for (const c of s.drawPile) set8(c.value, 1);
  at += DECK;
  const maskAt = base + HEADER + OBS;
  me.hand.slice(0, HAND).forEach((c, i) => slot.canon.forEach((pileId, p) => {
    if (isValidPlay(c, s.foundationPiles.find((x) => x.id === pileId)!)) out[maskAt + i * 4 + p] = 1;
  }));
  if (t.players > 1 && s.cardsPlayedThisTurn >= required) out[maskAt + END] = 1;
}

function apply(e: number, action: number): void {
  const slot = slots[e]!;
  const before = slot.state;
  const me = before.players[before.currentPlayerIndex]!;
  let after: GameState;
  if (action === END) after = endTurn(before, me.id);
  else {
    const card = me.hand[Math.floor(action / 4)];
    if (!card) throw new Error(`Action ${action} names an empty slot`);
    after = playCard(before, me.id, card.id, slot.canon[action % 4]!);
  }
  let reward = phi(after) - phi(before);
  if (after.gamePhase === 'playing') { slot.state = after; lastReward[e] = reward; lastDone[e] = 0; return; }
  reward += after.gamePhase === 'won' ? 100 : 91;
  const left = after.drawPile.length + after.players.reduce((n, p) => n + p.hand.length, 0);
  finished[e] = { seed: slot.seedIndex, outcome: after.gamePhase === 'won' ? 1 : 2, left, draw: after.drawPile.length, table: slot.table };
  lastReward[e] = reward; lastDone[e] = 1;
  slot.history = [];
  slot.cursor += stride;
  slot.seedIndex = slot.cursor;
  slot.state = start(slot.table, slot.seedIndex);
  slot.lags = seatLags(slot.table, slot.seedIndex);
}

for (let e = 0; e < E; e += 1) writeRecord(e);
process.stdout.write(out);
let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length < E * 2) return;
  for (let e = 0; e < E; e += 1) apply(e, pending.readInt16LE(e * 2));
  pending = pending.subarray(E * 2);
  for (let e = 0; e < E; e += 1) { writeRecord(e); finished[e] = null; }
  process.stdout.write(out);
});
