import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadNetwork, networkChoice, networkLogits, type NetworkWeights } from '../src/network.js';
import type { NetInput } from '../src/netinput.js';

interface Case { hand: number[]; tops: number[]; globals: number[]; others: number[]; react: number[]; seatKind: number[]; played: number[]; mask: number[]; logits: Record<string, number> }

const weights = JSON.parse(readFileSync(new URL('../models/robot.json', import.meta.url), 'utf8')) as NetworkWeights;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/network-robot.json', import.meta.url), 'utf8')) as { cases: Case[] };
const net = loadNetwork(weights);
const inputOf = (c: Case): NetInput => ({ ...c, canon: [0, 1, 2, 3] });

// The fixtures are positions the Python network scored (tools/training/export_weights.py). The TypeScript network must give the same numbers,
// otherwise a robot in the game would not play as the network did in training.
describe('the TypeScript network matches the Python one', () => {
  it('gives the same score for every legal action in 60 recorded positions', () => {
    let worst = 0;
    let checked = 0;
    for (const c of fixtures.cases) {
      const logits = networkLogits(net, inputOf(c));
      for (const [a, want] of Object.entries(c.logits)) {
        worst = Math.max(worst, Math.abs(logits[Number(a)]! - want));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(worst).toBeLessThan(1e-3);
  });

  it('picks the same action as the Python network', () => {
    for (const c of fixtures.cases) {
      const want = Object.entries(c.logits).reduce((best, e) => (e[1] > best[1] ? e : best));
      const second = Object.values(c.logits).sort((a, b) => b - a)[1] ?? -Infinity;
      if (want[1] - second < 1e-2) continue; // a near tie may fall either way within rounding
      expect(networkChoice(net, inputOf(c))).toBe(Number(want[0]));
    }
  });

  it('never scores an illegal action above a legal one', () => {
    for (const c of fixtures.cases) {
      const logits = networkLogits(net, inputOf(c));
      c.mask.forEach((legal, a) => { if (!legal) expect(logits[a]).toBeLessThan(-1e8); });
    }
  });
});
