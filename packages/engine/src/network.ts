import { NET_ACTIONS, NET_DECK, NET_END, NET_HAND, NET_OTHERS, type NetInput } from './netinput.js';

// The trained policy network, run in TypeScript. It is the same arithmetic as tools/training/model.py and features.py (a parity test compares
// the two on recorded positions), so a robot in the game plays as the network did in training. Weights come from tools/training/export_weights.py.
export interface NetworkWeights {
  width: number;
  tierB: boolean;
  reactions: boolean;
  pairRule?: boolean;
  trainedSteps?: number | null;
  source?: string;
  tensors: Record<string, { shape: number[]; data: number[] }>;
}

interface Linear { w: Float64Array; b: Float64Array; inn: number; out: number }
export interface Network { width: number; tierB: boolean; reactions: boolean; pairRule: boolean; layers: Record<string, Linear> }

export function loadNetwork(weights: NetworkWeights): Network {
  const layers: Record<string, Linear> = {};
  for (const name of ['record.0', 'record.2', 'glob.0', 'glob.2', 'pair.0', 'pair.2', 'head.0', 'head.2', 'end.0', 'end.2', 'hand_pool']) {
    const w = weights.tensors[`${name}.weight`];
    const b = weights.tensors[`${name}.bias`];
    if (!w || !b) throw new Error(`Network weights are missing ${name}`);
    layers[name] = { w: Float64Array.from(w.data), b: Float64Array.from(b.data), out: w.shape[0]!, inn: w.shape[1]! };
  }
  return { width: weights.width, tierB: weights.tierB, reactions: weights.reactions, pairRule: weights.pairRule === true, layers };
}

function linear(l: Linear, x: ArrayLike<number>, relu: boolean): Float64Array {
  const out = new Float64Array(l.out);
  for (let o = 0; o < l.out; o += 1) {
    let sum = l.b[o]!;
    const row = o * l.inn;
    for (let i = 0; i < l.inn; i += 1) sum += l.w[row + i]! * x[i]!;
    out[o] = relu && sum < 0 ? 0 : sum;
  }
  return out;
}

const KIND = [1, 1, 0, 0];
const relu = (v: Float64Array): Float64Array => { for (let i = 0; i < v.length; i += 1) if (v[i]! < 0) v[i] = 0; return v; };

// Scores for the 45 actions (card slot * 4 + canonical pile, then 'end turn'); illegal ones are -1e9.
export function networkLogits(net: Network, input: NetInput): number[] {
  const { hand, tops, globals, others, react, seatKind, played, mask } = input;
  const [players, handSize, lo, hi, perTurn, refill, drawCount, playedThisTurn, required, solitaire, tierB, reactionsOn] = globals as [number, number, number, number, number, number, number, number, number, number, number, number];
  const span = Math.max(1, hi - lo + 1);
  const hs = Math.max(1, handSize);
  const present: number[] = hand.map((v) => (v > 0 ? 1 : 0));
  const held = new Set(hand.filter((v) => v > 0));
  const valid: number[][] = [], back10: number[][] = [], gap: number[][] = [], skipped: number[][] = [], unseen: number[][] = [];
  // running count of unseen cards by value (not in the hand, not played), inside the deck
  const cs = new Array<number>(NET_DECK).fill(0);
  let run = 0;
  for (let v = 0; v < NET_DECK; v += 1) {
    if (v >= lo && v <= hi && !held.has(v) && !played[v]) run += 1;
    cs[v] = run;
  }
  const at = (ix: number): number => cs[Math.min(NET_DECK - 1, Math.max(0, ix))]!;
  for (let i = 0; i < NET_HAND; i += 1) {
    valid.push([]); back10.push([]); gap.push([]); skipped.push([]); unseen.push([]);
    const v = hand[i]!;
    for (let p = 0; p < 4; p += 1) {
      const t = tops[p]!;
      const asc = KIND[p] === 1;
      const ok = mask[i * 4 + p] === 1;
      const back = present[i] === 1 && (asc ? v === t - 10 : v === t + 10);
      valid[i]!.push(ok ? 1 : 0);
      back10[i]!.push(back ? 1 : 0);
      gap[i]!.push(ok ? (back ? 0 : Math.abs(asc ? v - t : t - v)) / span : 0);
      let jumped = 0;
      for (let k = 0; k < NET_HAND; k += 1) {
        const w = hand[k]!;
        if (present[k] !== 1) continue;
        if (asc ? w > t && w < v && w !== v - 10 : w < t && w > v && w !== v + 10) jumped += 1;
      }
      skipped[i]!.push(back ? 0 : jumped / hs);
      const between = asc ? at(v - 1) - at(t) : at(t - 1) - at(v);
      unseen[i]!.push(ok && !back ? Math.max(0, between) / 10 : 0);
    }
  }
  const cardFeat: number[][] = [];
  for (let i = 0; i < NET_HAND; i += 1) {
    const vc = valid[i]!.reduce((a, b) => a + b, 0);
    let minGap = Infinity;
    for (let p = 0; p < 4; p += 1) minGap = Math.min(minGap, valid[i]![p]! > 0.5 ? gap[i]![p]! : 1);
    cardFeat.push([present[i]!, (Math.max(0, hand[i]! - lo) / span) * present[i]!, vc / 4, minGap * present[i]! + (1 - present[i]!)]);
  }
  const pileFeat: number[][] = [];
  for (let p = 0; p < 4; p += 1) {
    const seatReact = Array.from({ length: NET_OTHERS }, (_, k) => react[k * 4 + p]! / 3);
    const progress = (KIND[p] === 1 ? tops[p]! - (lo - 1) : hi + 1 - tops[p]!) / span;
    let validCount = 0, minGap = Infinity;
    for (let i = 0; i < NET_HAND; i += 1) { validCount += valid[i]![p]!; minGap = Math.min(minGap, valid[i]![p]! > 0.5 ? gap[i]![p]! : 1); }
    pileFeat.push([KIND[p]!, progress, Math.max(...seatReact), seatReact.reduce((a, b) => a + b, 0) / NET_OTHERS, validCount / hs, minGap, ...seatReact]);
  }
  const presentCount = present.reduce((a, b) => a + b, 0);
  const glob = [players / 6, handSize / 11, span / 100, perTurn / 6, refill, drawCount / span, playedThisTurn / 6, required / 6, solitaire, tierB, reactionsOn,
    presentCount / 11, ...others.map((o) => o / 11), (others.reduce((a, b) => a + b, 0) + presentCount) / 66, ...seatKind];
  const L = net.layers;
  const rec = linear(L['record.2']!, linear(L['record.0']!, played.map((v) => v * tierB), true), false);
  const g = relu(linear(L['glob.2']!, linear(L['glob.0']!, [...glob, ...rec], true), false));
  const w = net.width;
  const pairH = new Map<number, Float64Array>();
  const cardCtx = Array.from({ length: NET_HAND }, () => new Float64Array(w));
  for (let i = 0; i < NET_HAND; i += 1) for (let p = 0; p < 4; p += 1) {
    if (valid[i]![p]! < 0.5) continue;
    const x = [valid[i]![p]!, back10[i]![p]!, gap[i]![p]!, skipped[i]![p]!, unseen[i]![p]!, ...cardFeat[i]!, ...pileFeat[p]!, ...g];
    const h = relu(linear(L['pair.2']!, linear(L['pair.0']!, x, true), false));
    pairH.set(i * 4 + p, h);
    for (let j = 0; j < w; j += 1) if (h[j]! > cardCtx[i]![j]!) cardCtx[i]![j] = h[j]!;
  }
  const logits = new Array<number>(NET_ACTIONS).fill(-1e9);
  for (const [a, h] of pairH) {
    const i = Math.floor(a / 4);
    logits[a] = linear(L['head.2']!, linear(L['head.0']!, [...h, ...cardCtx[i]!, ...g], true), false)[0]!;
  }
  if (mask[NET_END] === 1) {
    const pooled = new Float64Array(w);
    for (let i = 0; i < NET_HAND; i += 1) for (let j = 0; j < w; j += 1) pooled[j] = Math.max(pooled[j]!, cardCtx[i]![j]! * present[i]!);
    const handCtx = relu(linear(L['hand_pool']!, pooled, false));
    logits[NET_END] = linear(L['end.2']!, linear(L['end.0']!, [...g, ...handCtx], true), false)[0]!;
  }
  return logits;
}

// The network's pick: the legal action with the highest score.
export function networkChoice(net: Network, input: NetInput): number {
  const logits = networkLogits(net, input);
  let best = -1;
  for (let a = 0; a < NET_ACTIONS; a += 1) if (input.mask[a] === 1 && (best < 0 || logits[a]! > logits[best]!)) best = a;
  if (best < 0) throw new Error('No legal action');
  return best;
}
export { NET_END };
