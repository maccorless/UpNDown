import type { ResultRow } from '@upndown/shared-types';
import { CATALOG, type Ctx } from './catalog.js';
import { ordered } from './order.js';

export interface BadgeState {
  id: string;
  // 0 locked, 1 to 3 Bronze, Silver, Gold. A one-time badge is 0 or 1.
  tier: 0 | 1 | 2 | 3;
  progress: { value: number | null; nextTarget: number | null };
  // One entry per tier earned: the end time of the game that reached it, or null when no game is to credit (signing in).
  unlockedAtMs: Array<number | null>;
}

// Which badges these rows earn, in catalog order. Pure: the same rows give the same answer in the browser and on the
// server, in any order, and a game sent twice counts once.
export function evaluateAchievements(input: readonly ResultRow[], ctx: Ctx): BadgeState[] {
  const rows = ordered(input);
  return CATALOG.map((badge) => {
    const reached = (value: number | null, target: number): boolean => value !== null && (badge.direction === 'atLeast' ? value >= target : value <= target);
    const tracker = badge.track(ctx);
    const unlockedAtMs: Array<number | null> = [];
    for (const r of rows) {
      tracker.step(r);
      const v = tracker.value();
      while (unlockedAtMs.length < badge.targets.length && reached(v, badge.targets[unlockedAtMs.length]!)) unlockedAtMs.push(r.endedAtMs);
    }
    // A badge that needs no game (signing in) is earned without a date.
    const v = tracker.value();
    while (unlockedAtMs.length < badge.targets.length && reached(v, badge.targets[unlockedAtMs.length]!)) unlockedAtMs.push(null);
    const tier = unlockedAtMs.length as 0 | 1 | 2 | 3;
    return { id: badge.id, tier, progress: { value: v, nextTarget: badge.targets[tier] ?? null }, unlockedAtMs };
  });
}
