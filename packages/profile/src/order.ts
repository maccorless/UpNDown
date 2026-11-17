import type { ResultRow } from '@upndown/shared-types';

// Rows in the order games ended, each game once. Everything in this package reads rows through this, so the order the
// rows arrive in (or a game sent twice) never changes an answer.
export function ordered(rows: readonly ResultRow[]): ResultRow[] {
  const byId = new Map<string, ResultRow>();
  for (const r of rows) if (!byId.has(r.gameId)) byId.set(r.gameId, r);
  return [...byId.values()].sort((a, b) => a.endedAtMs - b.endedAtMs || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
}

export const finished = (r: ResultRow): boolean => r.outcome !== 'abandoned';
