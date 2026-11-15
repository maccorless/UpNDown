import { seededRandom } from './simulate.js';

// The statistics the evaluation protocol uses (docs/plans/2026-11-15-training-mode-plan.md, section 8). Plain functions with
// no dependencies, so a result can be checked by hand.

const Z95 = 1.959964;

export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export function standardDeviation(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

// Wilson score interval for a proportion: well behaved at small counts and near 0 and 1, where the usual plus-or-minus is not.
export function wilsonInterval(successes: number, n: number, z: number = Z95): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface Interval { mean: number; low: number; high: number }

// A 95% interval for the mean of paired differences. Small samples are bootstrapped (resampling the differences); a large one
// uses the normal approximation, which the bootstrap converges to and which costs nothing at 200,000 games.
export function pairedInterval(differences: readonly number[], options: { seed?: number; resamples?: number } = {}): Interval {
  const n = differences.length;
  const m = mean(differences);
  if (n === 0) return { mean: 0, low: 0, high: 0 };
  if (n > 20_000) {
    const half = (Z95 * standardDeviation(differences)) / Math.sqrt(n);
    return { mean: m, low: m - half, high: m + half };
  }
  const random = seededRandom(options.seed ?? 1);
  const resamples = options.resamples ?? 2000;
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += differences[Math.floor(random() * n)]!;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { mean: m, low: means[Math.floor(0.025 * resamples)]!, high: means[Math.min(resamples - 1, Math.floor(0.975 * resamples))]! };
}

const logChoose = (n: number, k: number): number => {
  let out = 0;
  for (let i = 1; i <= k; i += 1) out += Math.log(n - k + i) - Math.log(i);
  return out;
};

// McNemar's test for paired win/loss: `b` games only A won, `c` games only B won. Exact (binomial) up to 1,000 discordant
// games, the continuity-corrected normal approximation above that. Two-sided.
export function mcnemarPValue(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  if (n > 1000) {
    const z = (Math.abs(b - c) - 1) / Math.sqrt(n);
    return Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
  }
  const k = Math.min(b, c);
  let cumulative = 0;
  for (let i = 0; i <= k; i += 1) cumulative += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * cumulative);
}

// Standard normal cumulative distribution (Abramowitz and Stegun 26.2.17, error below 1e-7).
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - tail : tail;
}

// Holm's step-down correction for many comparisons: the adjusted p-values, in the order given. A comparison counts only if
// its adjusted p-value is below the chosen level.
export function holmAdjust(pValues: readonly number[]): number[] {
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(pValues.length).fill(1);
  let running = 0;
  order.forEach(({ p, index }, rank) => {
    running = Math.max(running, Math.min(1, (pValues.length - rank) * p));
    adjusted[index] = running;
  });
  return adjusted;
}

// Games needed to detect a paired difference `d` when one game's paired difference has standard deviation `sd`, at 95%
// confidence and 80% power: about 7.85 * sd^2 / d^2.
export function pairedSampleSize(sd: number, d: number, zAlpha = Z95, zBeta = 0.841621): number {
  return Math.ceil(((zAlpha + zBeta) ** 2 * sd * sd) / (d * d));
}
