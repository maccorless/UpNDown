import { NET_END, type NetInput } from './netinput.js';

// Why the network chose a move, in words a player can check against the table. The network itself cannot say why, so this does not claim to read its mind:
// it compares the chosen move with the alternatives on facts anyone can count (how far the pile moves, how many of your own cards it jumps over or strands,
// how many can still follow, what a teammate has marked, and, with the played-card record, how many unseen cards it jumps over), says which of those favour
// the move, and says plainly when none of them explains it.
export interface Explanation {
  // One sentence about the move itself.
  headline: string;
  // Up to three reasons, most telling first. Never empty.
  reasons: string[];
}

interface Facts {
  slot: number; pile: number; value: number; top: number; ascending: boolean;
  steps: number; backward: boolean; jumpedOwn: number; stranded: number; follow: number[]; room: number; unseenJumped: number | null;
  asked: { seat: number; level: number } | null;
}

const LEVEL_WORD = ['', 'likes', 'loves', 'really loves'];
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const pileWord = (ascending: boolean, top: number): string => `${ascending ? 'up' : 'down'} pile showing ${top}`;
// At most three numbers, then a count of the rest: "67, 51 and 39" or "67, 51, 39 and 3 more".
const list = (values: number[]): string => {
  if (values.length <= 3) return values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
  return `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`;
};

function factsFor(input: NetInput, slot: number, pile: number): Facts {
  const value = input.hand[slot]!;
  const top = input.tops[pile]!;
  const ascending = pile < 2;
  const [, , lo, hi] = input.globals as [number, number, number, number];
  const backward = ascending ? value === top - 10 : value === top + 10;
  const others = input.hand.filter((v, i) => v > 0 && i !== slot);
  const jumped = backward ? [] : others.filter((w) => (ascending ? w > top && w < value && w !== value - 10 : w < top && w > value && w !== value + 10));
  const newTop = value;
  const playableOn = (w: number, p: number): boolean => {
    const t = p === pile ? newTop : input.tops[p]!;
    return p < 2 ? w > t || w === t - 10 : w < t || w === t + 10;
  };
  const stranded = others.filter((w) => ![0, 1, 2, 3].some((p) => playableOn(w, p))).length;
  const follow = others.filter((w) => playableOn(w, pile) && (ascending ? w > newTop : w < newTop)).sort((a, b) => (ascending ? a - b : b - a));
  let unseenJumped: number | null = null;
  if (input.globals[10] === 1 && !backward) {
    const held = new Set(input.hand.filter((v) => v > 0));
    const from = ascending ? top + 1 : value + 1;
    const to = ascending ? value - 1 : top - 1;
    let n = 0;
    for (let v = Math.max(from, lo); v <= Math.min(to, hi); v += 1) if (!held.has(v) && !input.played[v]) n += 1;
    unseenJumped = n;
  }
  let asked: Facts['asked'] = null;
  for (let k = 0; k < 5; k += 1) {
    const level = input.react[k * 4 + pile]!;
    if (level > 0 && (!asked || level > asked.level)) asked = { seat: k, level };
  }
  return { slot, pile, value, top, ascending, steps: backward ? 0 : Math.abs(value - top), backward, jumpedOwn: jumped.length, stranded, follow, room: ascending ? hi - value : value - lo, unseenJumped, asked };
}

export function explainMove(input: NetInput, action: number, logits: readonly number[], seatNames: readonly string[] = []): Explanation {
  const plays: Facts[] = [];
  for (let a = 0; a < NET_END; a += 1) if (input.mask[a] === 1) plays.push(factsFor(input, Math.floor(a / 4), a % 4));
  const name = (k: number): string => seatNames[k] ?? `Player ${k + 1}`;
  const legal = input.mask.map((m, a) => (m === 1 ? a : -1)).filter((a) => a >= 0);
  // The same card on the other pile of the same kind and top is the same move, not an alternative.
  const same = (a: number): boolean => a < NET_END && action < NET_END && Math.floor(a / 4) === Math.floor(action / 4) && (a % 4 < 2) === (action % 4 < 2) && input.tops[a % 4] === input.tops[action % 4];
  const second = legal.filter((a) => a !== action && !same(a)).sort((a, b) => logits[b]! - logits[a]!)[0];
  const close = second !== undefined && logits[action]! - logits[second]! < 0.3;
  const closeNote = (): string | null => {
    if (!close || second === undefined) return null;
    if (second === NET_END) return 'Close call: ending your turn is nearly as good.';
    const f = factsFor(input, Math.floor(second / 4), second % 4);
    return `Close call: the ${f.value} on the ${pileWord(f.ascending, f.top)} is nearly as good.`;
  };
  // The smallest move among the ordinary (forward) plays; a backward 10 is a bonus, not a small step.
  const forward = plays.filter((f) => !f.backward);
  const smallest = forward.length ? Math.min(...forward.map((f) => f.steps)) : 0;

  if (action === NET_END) {
    const [, , , , , , , playedThisTurn] = input.globals as number[];
    const reasons = [`You have already played ${plural(playedThisTurn!, 'card')} this turn, the minimum.`];
    reasons.push(plays.length === 0 ? 'No other card can be played.' : `Your smallest remaining move is ${plural(smallest, 'step')}; ending here leaves that room for the next player.`);
    const c = closeNote();
    if (c) reasons.push(c);
    return { headline: 'End your turn.', reasons: reasons.slice(0, 3) };
  }

  const c = plays.find((f) => f.slot === Math.floor(action / 4) && f.pile === action % 4)!;
  const reasons: string[] = [];
  if (c.backward) reasons.push('A backward 10: it sets that pile back by 10 for free.');
  else if (c.steps === smallest) reasons.push(`The smallest move you have (${plural(c.steps, 'step')}).`);
  else {
    // not the smallest move: say what the smallest one would cost, from facts that favour this move
    const s = [...forward].sort((a, b) => a.steps - b.steps || a.jumpedOwn - b.jumpedOwn)[0]!;
    const better: string[] = [];
    if (s.stranded > c.stranded) better.push(`the smaller move would leave ${plural(s.stranded, 'card')} of yours with nowhere to go`);
    if (c.unseenJumped !== null && s.unseenJumped !== null && s.unseenJumped > c.unseenJumped) better.push(`the smaller move would jump over ${plural(s.unseenJumped, 'card')} still to come`);
    if (s.asked && (!c.asked || c.asked.level < s.asked.level)) better.push(`${name(s.asked.seat)} ${LEVEL_WORD[s.asked.level]} the ${pileWord(s.ascending, s.top)} that move would use`);
    if (c.follow.length > s.follow.length) better.push(`this one keeps ${list(c.follow)} able to follow on that pile`);
    const cleaned = better;
    reasons.push(`A bigger step (${plural(c.steps, 'step')}) than your smallest (${plural(s.steps, 'step')}, the ${s.value} on the ${pileWord(s.ascending, s.top)})${cleaned.length ? `, because ${cleaned.slice(0, 2).join(' and ')}.` : '.'}`);
    if (!cleaned.length) reasons.push('No single rule explains this one: the trained model weighs your whole hand and the cards still out.');
  }
  if (c.follow.length > 0 && reasons.length < 3) reasons.push(`Your ${list(c.follow)} can still follow on that pile.`);
  if (c.jumpedOwn === 0 && c.stranded === 0 && !c.backward && c.steps !== smallest && reasons.length < 3) reasons.push('It jumps over none of your cards and strands none.');
  if (c.unseenJumped !== null && reasons.length < 3) reasons.push(c.unseenJumped === 0 ? 'It jumps over no cards that could still turn up.' : `It jumps over ${plural(c.unseenJumped, 'card')} that could still turn up.`);
  if (c.asked && reasons.length < 3) reasons.push(`${name(c.asked.seat)} ${LEVEL_WORD[c.asked.level]} this pile, ${c.steps === smallest || c.backward ? 'but this is still the move to make' : 'yet the model still plays here'}.`);
  const note = closeNote();
  if (note && reasons.length < 3) reasons.push(note);
  return { headline: `Play the ${c.value} on the ${pileWord(c.ascending, c.top)}.`, reasons: reasons.slice(0, 3) };
}
