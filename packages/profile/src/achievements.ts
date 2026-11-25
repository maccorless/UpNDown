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

// The badges as they stood before the newest game: the same rows without it. Set beside the badges now, they show what that game did.
export function badgesBeforeLatest(input: readonly ResultRow[], ctx: Ctx): BadgeState[] {
  return evaluateAchievements(ordered(input).slice(0, -1), ctx);
}

export interface BadgeChange { tierUp: boolean; from: number | null; to: number | null }

// What changed for each badge between two evaluations: a tier earned, or the progress value moved. An unchanged badge has no entry.
export function badgeChanges(now: readonly BadgeState[], before: readonly BadgeState[]): Map<string, BadgeChange> {
  const changes = new Map<string, BadgeChange>();
  for (const state of now) {
    const was = before.find((b) => b.id === state.id);
    if (!was) continue;
    const tierUp = state.tier > was.tier;
    if (!tierUp && state.progress.value === was.progress.value) continue;
    changes.set(state.id, { tierUp, from: was.progress.value, to: state.progress.value });
  }
  return changes;
}
