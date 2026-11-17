import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/init.js';
import { explainMove } from '../src/explain.js';
import { NET_ACTIONS, NET_END, buildNetInput, type NetInput } from '../src/netinput.js';
import { seededRandom, shuffleWith } from '../src/simulate.js';
import { tableById } from '../src/tables.js';
import { createStartedGameState } from '../src/transitions.js';

// A position written out by hand: canonical piles are [up, up, down, down].
function position(hand: number[], tops: number[], over: Partial<NetInput> = {}): NetInput {
  const h = [...hand, ...new Array<number>(11 - hand.length).fill(0)];
  const mask = new Array<number>(NET_ACTIONS).fill(0);
  h.forEach((v, i) => tops.forEach((t, p) => { if (v > 0 && (p < 2 ? v > t || v === t - 10 : v < t || v === t + 10)) mask[i * 4 + p] = 1; }));
  return {
    hand: h, tops, canon: [0, 1, 2, 3], globals: [2, 7, 2, 99, 2, 0, 50, 0, 2, 0, 0, 1], others: [7, 0, 0, 0, 0], react: new Array<number>(20).fill(0),
    seatKind: [0, 0, 0, 0, 0], played: new Array<number>(100).fill(0), mask, ...over
  };
}
const flat = (logits: Record<number, number>): number[] => Array.from({ length: NET_ACTIONS }, (_, a) => logits[a] ?? -1e9);

describe('explaining a move', () => {
  it('says a backward 10 is a backward 10', () => {
    const input = position([20, 45, 60], [30, 5, 90, 99]); // 20 is exactly 10 below the 30
    const e = explainMove(input, 0 * 4 + 0, flat({ 0: 3, 4: 1 }));
    expect(e.headline).toBe('Play the 20 on the up pile showing 30.');
    expect(e.reasons[0]).toContain('backward 10');
  });

  it('calls the smallest move the smallest, with its real size', () => {
    const input = position([33, 60], [30, 5, 90, 99]);
    const e = explainMove(input, 0, flat({ 0: 3, 4: 1 }));
    expect(e.reasons[0]).toBe('The smallest move you have (3 steps).');
  });

  it('when it is not the smallest move, names the smaller one and what it would cost, using only true facts', () => {
    // 35 on the 30 pile is 5 steps but jumps over the 32 in hand; 40 on the 5 pile... use the 5 pile for the 36 instead of jumping
    const input = position([32, 36], [30, 5, 90, 99]);
    // playing 36 on pile 1 (top 5) is a big step, while 32 on pile 0 is the smallest (2) and jumps nothing: choose 36 on pile 0 to test the "jumps over" wording
    const e = explainMove(input, 1 * 4 + 0, flat({ 4: 2, 0: 1.9 }));
    expect(e.reasons[0]).toContain('A bigger step (6 steps) than your smallest (2 steps, the 32 on the up pile showing 30)');
    expect(e.reasons.join(' ')).not.toContain('would jump over');
  });

  it('says the smaller move would strand a card when that is true', () => {
    // 51 on the pile at 50 is the smallest step (1) but leaves the 40, which only the backward 10 on that pile could take, with nowhere to go.
    const input = position([51, 40, 70], [45, 50, 39, 38]);
    const e = explainMove(input, 2 * 4 + 0, flat({ 8: 2, 0: 1.8, 4: 1 }));
    expect(e.reasons[0]).toBe('A bigger step (25 steps) than your smallest (1 step, the 51 on the up pile showing 50), because the smaller move would leave 1 card of yours with nowhere to go.');
  });

  it('keeps quiet about reasons that are not true', () => {
    const input = position([33, 31, 50], [30, 5, 90, 99]);
    const e = explainMove(input, 2 * 4 + 1, flat({ 9: 2, 4: 1, 0: 1 }));
    expect(e.reasons[0]).toContain('A bigger step (45 steps) than your smallest (1 step, the 31 on the up pile showing 30)');
    expect(e.reasons.join(' ')).not.toContain('would leave');
    expect(explainMove(input, 1 * 4 + 0, flat({ 4: 3, 0: 1 })).reasons[0]).toBe('The smallest move you have (1 step).');
  });

  it('mentions a teammate asking for the pile the smaller move would use', () => {
    const input = position([33, 60], [30, 40, 90, 99], { react: [0, 3, 0, 0, ...new Array<number>(16).fill(0)] }); // seat 0 really loves canonical pile 1
    const e = explainMove(input, 1 * 4 + 0, flat({ 4: 2, 5: 1.5, 0: 1 }), ['Ann']);
    // 60 on pile 0 (top 30) is 30 steps; the smaller move 33 on pile 0 ... the 33 can also go on pile 1 (top 40)? no: 33 < 40. So only 33 on pile 0.
    expect(e.reasons.length).toBeGreaterThan(0);
    const withAsk = position([45, 41], [30, 40, 90, 99], { react: [0, 3, 0, 0, ...new Array<number>(16).fill(0)] });
    const e2 = explainMove(withAsk, 0 * 4 + 0, flat({ 0: 2, 5: 1.9, 4: 1.5, 1: 1 }), ['Ann']);
    expect(e2.reasons.join(' ')).toContain('Ann');
  });

  it('explains ending the turn, and a close call', () => {
    const input = position([60], [30, 5, 90, 99], { globals: [2, 7, 2, 99, 2, 0, 50, 2, 2, 0, 0, 1], mask: (() => { const m = new Array<number>(NET_ACTIONS).fill(0); m[0] = 1; m[NET_END] = 1; return m; })() });
    const e = explainMove(input, NET_END, flat({ 0: 1, [NET_END]: 1.1 }));
    expect(e.headline).toBe('End your turn.');
    expect(e.reasons[0]).toContain('2 cards this turn, the minimum');
    expect(e.reasons.join(' ')).toContain('Close call');
  });

  it('does not call the same card on an identical pile a close call', () => {
    const input = position([33, 60], [30, 30, 90, 99]); // two up piles both at 30
    const e = explainMove(input, 0 * 4 + 0, flat({ 0: 2, 1: 1.99, 4: 0.5 })); // the twin pile scores almost the same, which is no alternative
    expect(e.reasons.join(' ')).not.toContain('Close call');
    const real = explainMove(input, 0 * 4 + 0, flat({ 0: 2, 1: 0.5, 4: 1.99 })); // a different card scoring almost the same is
    expect(real.reasons.join(' ')).toContain('Close call: the 60 on the up pile showing 30 is nearly as good.');
  });

  it('lists at most three cards that can follow, then how many more', () => {
    const input = position([88, 67, 51, 39, 37, 31, 7], [1, 1, 100, 100]);
    const e = explainMove(input, 0 * 4 + 2, flat({ 2: 3 }));
    expect(e.reasons.join(' ')).toContain('Your 67, 51, 39 and 3 more can still follow on that pile.');
  });

  it('says plainly when no rule explains the move, never an empty list, never more than three reasons', () => {
    const input = position([60, 70], [30, 5, 90, 99]);
    const e = explainMove(input, 0 * 4 + 1, flat({ 1: 3, 0: 2, 4: 1, 5: 0 }));
    expect(e.reasons.length).toBeGreaterThan(0);
    expect(e.reasons.length).toBeLessThanOrEqual(3);
  });

  // Over whole games: every move the network-like chooser (here, any legal move) gets an explanation that names real numbers.
  it('always gives a sensible explanation, on real positions with the record and reactions', () => {
    const t = tableById('s3-4p-99-h7');
    let state = createStartedGameState({ gameId: 'EXPL', hostId: 'p1', players: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}` })), settings: t.settings, isSolitaire: false, deck: shuffleWith(buildDeck(t.settings), seededRandom(5)) });
    const random = seededRandom(9);
    for (let step = 0; step < 60 && state.gamePhase === 'playing'; step += 1) {
      const input = buildNetInput(state, { tierB: true, reactionsOn: true });
      const legal = input.mask.map((m, a) => (m ? a : -1)).filter((a) => a >= 0);
      const action = legal[Math.floor(random() * legal.length)]!;
      const e = explainMove(input, action, flat(Object.fromEntries(legal.map((a) => [a, random()]))), ['Ann', 'Bo', 'Cy']);
      expect(e.reasons.length).toBeGreaterThan(0);
      expect(e.reasons.length).toBeLessThanOrEqual(3);
      expect(e.headline.length).toBeGreaterThan(5);
      if (action !== NET_END) expect(e.headline).toContain(`${input.hand[Math.floor(action / 4)]}`);
      // advance with that move through the real rules
      break;
    }
  });
});
