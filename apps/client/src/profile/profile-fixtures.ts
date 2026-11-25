import { badgesBeforeLatest, computeStats, evaluateAchievements } from '@upndown/profile';
import type { ResultRow } from '@upndown/shared-types';
import type { AuthState } from '../auth/useAuth.js';
import type { ProfileData, ProfileSource } from './source.js';
import type { ProfileView } from './useProfile.js';

export const NOW = Date.parse('2026-11-20T12:00:00Z');

let n = 0;
export const row = (over: Partial<ResultRow> = {}): ResultRow => {
  n += 1;
  const endedAtMs = over.endedAtMs ?? NOW - n * 3_600_000;
  return {
    gameId: `fx-${n}`, mode: 'multiplayer', outcome: 'won', startedAtMs: endedAtMs - 600_000, endedAtMs, durationMs: 600_000, turns: 9, playerCount: 2, robotCount: 0,
    cardsTotal: 98, cardsLeft: 0, cardsPlayed: 40, totalMovement: 50, specialPlays: 1, skips: 0, trades: 0, lookups: 0, hints: 0, undos: 0, marks: 0, playedLastCard: false, lifelines: null, markFollows: null,
    handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false, ...over
  };
};

export const dataFor = (rows: ResultRow[], signedIn = false, waiting = 0): ProfileData => ({
  stats: computeStats(rows, { tz: 'UTC', now: NOW }),
  badges: evaluateAchievements(rows, { tz: 'UTC', now: NOW, signedIn }),
  beforeLatest: badgesBeforeLatest(rows, { tz: 'UTC', now: NOW, signedIn }),
  waiting
});

export const sourceOf = (rows: ResultRow[] = [], pages: Array<{ rows: ResultRow[]; next: string | null }> = [{ rows, next: null }]): ProfileSource => {
  let i = 0;
  return { kind: 'local', load: async () => dataFor(rows), history: async () => pages[Math.min(i++, pages.length - 1)]! };
};

export const viewOf = (over: Partial<ProfileView> = {}): ProfileView => ({ source: sourceOf(), state: 'ready', data: dataFor([]), reload: () => undefined, storageStatus: 'ok', ...over });

export const authOf = (over: Partial<AuthState> = {}): AuthState => ({
  status: 'guest', storage: 'ok', userId: null, playerName: null, nameConfirmed: true, settings: null, loginMessage: null,
  signIn: () => undefined, signOut: async () => undefined, confirmName: async (name) => name, dismissLoginMessage: () => undefined, ...over
});
