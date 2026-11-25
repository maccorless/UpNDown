import { badgesBeforeLatest, computeStats, evaluateAchievements, type BadgeState, type ProfileStats } from '@upndown/profile';
import type { ResultRow } from '@upndown/shared-types';
import type { LocalHistory } from './local-history.js';
import type { Outbox } from './outbox.js';

// beforeLatest is the same badges computed without the newest game: what that game changed is the difference.
export interface ProfileData { stats: ProfileStats; badges: BadgeState[]; beforeLatest: BadgeState[]; waiting: number }
export interface HistoryPage { rows: ResultRow[]; next: string | null }

// Where a profile page gets its numbers: this device for a guest, the server for an account. The page does not know which.
export interface ProfileSource {
  kind: 'local' | 'account';
  load(tz: string): Promise<ProfileData>;
  history(cursor: string | null): Promise<HistoryPage>;
}

const PAGE = 50;

export function localSource(history: LocalHistory, now: () => number = Date.now): ProfileSource {
  return {
    kind: 'local',
    async load(tz) {
      const rows = history.load().rows;
      const ctx = { tz, now: now(), signedIn: false };
      return { stats: computeStats(rows, { tz, now: now() }), badges: evaluateAchievements(rows, ctx), beforeLatest: badgesBeforeLatest(rows, ctx), waiting: 0 };
    },
    async history(cursor) {
      const newestFirst = [...history.load().rows].sort((a, b) => b.endedAtMs - a.endedAtMs || (a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0));
      const at = cursor ? /^(\d+):(.+)$/.exec(cursor) : null;
      const after = at ? newestFirst.filter((r) => r.endedAtMs < Number(at[1]) || (r.endedAtMs === Number(at[1]) && r.gameId < at[2]!)) : newestFirst;
      const rows = after.slice(0, PAGE);
      const last = rows[rows.length - 1];
      return { rows, next: after.length > PAGE && last ? `${last.endedAtMs}:${last.gameId}` : null };
    }
  };
}

export function accountSource(outbox: Outbox, fetchImpl: typeof fetch = (...args) => fetch(...args)): ProfileSource {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json() as Promise<T>;
  };
  return {
    kind: 'account',
    async load(tz) {
      const zone = encodeURIComponent(tz);
      const [stats, badges] = await Promise.all([get<{ stats: ProfileStats }>(`/api/me/stats?tz=${zone}`), get<{ badges: BadgeState[]; beforeLatest?: BadgeState[] }>(`/api/me/achievements?tz=${zone}`)]);
      // An older server does not send beforeLatest; without it no change is shown, rather than a failed page.
      return { stats: stats.stats, badges: badges.badges, beforeLatest: badges.beforeLatest ?? [], waiting: outbox.pending().length };
    },
    history: (cursor) => get<HistoryPage>(`/api/me/games${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
  };
}
