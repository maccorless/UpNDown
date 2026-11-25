import { describe, expect, it } from 'vitest';
import type { ResultRow } from '@upndown/shared-types';
import { badgeChanges, badgesBeforeLatest, evaluateAchievements } from '../src/achievements.js';
import type { Ctx } from '../src/catalog.js';
import { at, row } from './helpers.js';

const ctx: Ctx = { tz: 'UTC', now: at('2026-12-31T00:00:00Z'), signedIn: false };
const many = (n: number, over: Partial<ResultRow> = {}): ResultRow[] => Array.from({ length: n }, () => row(over));

describe('what the newest game changed', () => {
  it('shows the badges as they stood before the newest game, so its effect is the difference from now', () => {
    const rows = many(10);
    const before = badgesBeforeLatest(rows, ctx).find((b) => b.id === 'regular')!;
    const now = evaluateAchievements(rows, ctx).find((b) => b.id === 'regular')!;
    expect(before.progress.value).toBe(9);
    expect(now.progress.value).toBe(10);
  });

  it('has nothing to compare with before the first game, so every badge reads as not yet earned', () => {
    expect(badgesBeforeLatest([], ctx).every((b) => b.tier === 0)).toBe(true);
  });

  it('reports the progress a game moved and the tier it earned, and nothing a game did not touch', () => {
    const rows = many(10);
    const changes = badgeChanges(evaluateAchievements(rows, ctx), badgesBeforeLatest(rows, ctx));
    expect(changes.get('regular')).toEqual({ tierUp: true, from: 9, to: 10 });
    expect(changes.has('table-flip')).toBe(false);
  });

  it('reports nothing when the newest game changed no badge, so an old highlight is not kept', () => {
    const badges = evaluateAchievements(many(3), ctx);
    expect(badgeChanges(badges, badges).size).toBe(0);
  });
});
