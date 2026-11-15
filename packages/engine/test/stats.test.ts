import { describe, expect, it } from 'vitest';
import { holmAdjust, mcnemarPValue, mean, normalCdf, pairedInterval, pairedSampleSize, standardDeviation, wilsonInterval } from '../src/stats.js';

// Checked against values worked out by hand, so a wrong formula cannot hide behind a test that repeats it.
describe('wilsonInterval', () => {
  it('gives about 13.3% to 28.9% for 20 wins in 100 games', () => {
    const [low, high] = wilsonInterval(20, 100);
    expect(low).toBeCloseTo(0.1334, 3);
    expect(high).toBeCloseTo(0.2888, 3);
  });

  it('stays inside 0 to 1 and is still wide with no wins in a few games', () => {
    const [low, high] = wilsonInterval(0, 10);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0.25);
    expect(wilsonInterval(10, 10)[1]).toBeCloseTo(1, 10);
  });

  it('narrows as games are added, about 1.5 points either side at 22% with 3,000 games', () => {
    const [low, high] = wilsonInterval(660, 3000);
    expect((high - low) / 2).toBeCloseTo(0.0148, 3);
  });
});

describe('mcnemarPValue', () => {
  it('is exact for few discordant games: 10 against 2 gives 0.0386', () => {
    expect(mcnemarPValue(10, 2)).toBeCloseTo(0.038574, 5);
    expect(mcnemarPValue(2, 10)).toBeCloseTo(0.038574, 5);
  });

  it('is 1 when nothing differs or the split is even, and small for a lopsided split of many games', () => {
    expect(mcnemarPValue(0, 0)).toBe(1);
    expect(mcnemarPValue(7, 7)).toBe(1);
    expect(mcnemarPValue(600, 450)).toBeLessThan(0.0001);
  });

  it('agrees between the exact and the approximate formula near the switch', () => {
    // 600 discordant games, 330 against 270: both formulas are valid here and should be close.
    const exactLike = mcnemarPValue(330, 270);
    const z = (Math.abs(330 - 270) - 1) / Math.sqrt(600);
    expect(exactLike).toBeCloseTo(2 * (1 - normalCdf(z)), 2);
  });
});

describe('holmAdjust', () => {
  it('multiplies the smallest p by the number of tests, the next by one fewer, and never lets a later one fall below an earlier one', () => {
    expect(holmAdjust([0.01, 0.04, 0.03, 0.005]).map((p) => Number(p.toFixed(4)))).toEqual([0.03, 0.06, 0.06, 0.02]);
  });

  it('caps at 1', () => {
    expect(holmAdjust([0.6, 0.7])).toEqual([1, 1]);
  });
});

describe('pairedSampleSize', () => {
  it('needs about 442 games to see 2 points when a paired game varies by 15', () => {
    expect(pairedSampleSize(15, 2)).toBe(442);
  });

  it('needs a hundred times as many games to see a tenth of the difference', () => {
    expect(pairedSampleSize(15, 0.2) / pairedSampleSize(15, 2)).toBeGreaterThan(99);
  });
});

describe('pairedInterval', () => {
  it('contains the mean, is the same every time from one seed, and shrinks with more games', () => {
    const small = Array.from({ length: 200 }, (_, i) => (i % 7) - 2);
    const a = pairedInterval(small, { seed: 3 });
    expect(a).toEqual(pairedInterval(small, { seed: 3 }));
    expect(a.low).toBeLessThanOrEqual(a.mean);
    expect(a.high).toBeGreaterThanOrEqual(a.mean);
    const big = Array.from({ length: 5000 }, (_, i) => (i % 7) - 2);
    expect(pairedInterval(big).high - pairedInterval(big).low).toBeLessThan(a.high - a.low);
  });

  it('uses the normal approximation for a large sample and agrees with its formula', () => {
    const big = Array.from({ length: 40_000 }, (_, i) => ((i * 37) % 11) - 5 + 1);
    const interval = pairedInterval(big);
    const half = (1.959964 * standardDeviation(big)) / Math.sqrt(big.length);
    expect(interval.high - interval.mean).toBeCloseTo(half, 6);
    expect(interval.mean).toBeCloseTo(mean(big), 10);
  });

  it('excludes zero for a clear gain and includes it for no gain', () => {
    const gain = Array.from({ length: 3000 }, (_, i) => 2 + ((i % 5) - 2));
    const none = Array.from({ length: 3000 }, (_, i) => (i % 5) - 2);
    expect(pairedInterval(gain).low).toBeGreaterThan(0);
    const zero = pairedInterval(none);
    expect(zero.low).toBeLessThanOrEqual(0);
    expect(zero.high).toBeGreaterThanOrEqual(0);
  });
});

describe('normalCdf', () => {
  it('is 0.5 at zero and about 0.975 at 1.96', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});
