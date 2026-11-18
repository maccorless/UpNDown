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
  buildNetInput, buildDeck, createStartedGameState, DEFAULT_SENDER, endTurn, honestBoard, playCard, seededRandom, seedsFor, shuffleWith, tableById
} from '../src/index.js';
import type { GameState } from '@upndown/shared-types';

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
// --pair-rule: the network is not offered the second card of a ten-apart pair while its partner is in the hand (src/complement.ts).
const pairRule = process.argv.includes('--pair-rule');
// --lag k: the reactions a player sees are the ones shown k plays ago (people do not update instantly).
const lag = Number(arg('lag', '0'));
// --seat-mix p: each seat of a new game is a robot (instant, exact reactions) with probability p, otherwise human-like: reactions 1 or 3 plays old, or never shown.
const seatMix = process.argv.includes('--seat-mix') ? Number(arg('seat-mix', '1')) : null;
const HUMAN_LAGS = [1, 3, -1];
// --sender like,love,reallyLove: the thresholds (as shares of the deck) the honest senders use; default is the engine's.
const senderArg = arg('sender', '');
const sender = senderArg ? (() => { const [like, love, reallyLove] = senderArg.split(',').map(Number); return { like: like!, love: love!, reallyLove: reallyLove! }; })() : DEFAULT_SENDER;
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

function writeRecord(e: number): void {
  const slot = slots[e]!;
  const s = slot.state;
  const base = e * RECORD_BYTES;
  const f = finished[e];
  out.writeInt32LE(f ? f.seed : -1, base);
  out.writeUInt8(f ? f.outcome : 0, base + 4);
  out.writeInt16LE(f ? f.left : 0, base + 5);
  out.writeInt16LE(f ? f.draw : 0, base + 7);
  out.writeUInt8(f ? f.table : 0, base + 9);
  out.writeFloatLE(lastReward[e]!, base + 10);
  out.writeUInt8(lastDone[e]!, base + 14);
  out.fill(0, base + HEADER, base + RECORD_BYTES);
  // The reactions each other seat is shown: the honest board as it stands, by seat and real pile id, seen through that seat's lag (-1 = never shown).
  let board: number[][] | null = null;
  if (reactions && s.players.length > 1) {
    const honest = honestBoard(s, sender);
    const level = { like: 1, love: 2, really_love: 3 } as const;
    board = s.players.map((p) => [0, 1, 2, 3].map((pileId) => { const r = honest[p.id]?.[pileId]; return r ? level[r] : 0; }));
    slot.history.push(board);
    if (slot.history.length > 4) slot.history.shift();
  }
  const input = buildNetInput(s, {
    tierB: record, reactionsOn: reactions, pairRule,
    reactionsOf: (idx) => (slot.lags[idx]! < 0 ? null : slot.history[Math.max(0, slot.history.length - 1 - slot.lags[idx]!)]![idx]!),
    seatKindOf: (idx) => (slot.lags[idx] !== 0 ? 1 : 0)
  });
  slot.canon = input.canon;
  let at = base + HEADER;
  const put = (values: readonly number[]): void => { values.forEach((v, i) => out.writeInt8(v, at + i)); at += values.length; };
  put(input.hand); put(input.tops); put(input.globals); put(input.others); put(input.react); put(input.seatKind); put(input.played);
  // Privileged fields for the critic only: the other seats' hands and the draw pile as a set.
  const cur = s.currentPlayerIndex, players = s.players.length;
  for (let k = 1; k < players; k += 1) s.players[(cur + k) % players]!.hand.slice(0, HAND).forEach((c, i) => out.writeInt8(c.value, at + (k - 1) * HAND + i));
  at += OTHERS * HAND;
  for (const c of s.drawPile) out.writeInt8(1, at + c.value);
  at += DECK;
  input.mask.forEach((v, i) => { if (v) out[at + i] = 1; });
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
