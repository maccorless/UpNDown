import type { ResultRow } from '@upndown/shared-types';
import { finished, ordered } from './order.js';
import { localParts } from './time.js';

export interface Slice { key: string; label: string; games: number; wins: number; losses: number; winRate: number | null }

export interface ProfileStats {
  totals: { games: number; wins: number; losses: number; abandoned: number; winRate: number | null; cardsPlayed: number; backwardTens: number; totalMovement: number; avgMovementPerCard: number | null; timePlayedMs: number };
  streaks: { currentWin: number; bestWin: number; currentDay: number; bestDay: number };
  records: { fastestWinMs: number | null; fewestCardsLeftInLoss: number | null; mostBackwardTens: number; longestGameMs: number; biggestTableWon: number };
  breakdowns: { byMode: Slice[]; byPlayerCount: Slice[]; byDifficulty: Slice[]; byRobots: Slice[] };
  cheats: { skips: number; trades: number; lookups: number; hints: number };
  // The last 20 games, oldest first.
  trend: Array<'W' | 'L' | 'A'>;
}

const rate = (wins: number, losses: number): number | null => (wins + losses > 0 ? wins / (wins + losses) : null);

function slices(rows: readonly ResultRow[], keyOf: (r: ResultRow) => [string, string]): Slice[] {
  const map = new Map<string, Slice>();
  for (const r of rows) {
    const [key, label] = keyOf(r);
    const s = map.get(key) ?? { key, label, games: 0, wins: 0, losses: 0, winRate: null };
    s.games += 1;
    if (r.outcome === 'won') s.wins += 1;
    if (r.outcome === 'lost') s.losses += 1;
    map.set(key, s);
  }
  return [...map.values()].map((s) => ({ ...s, winRate: rate(s.wins, s.losses) }));
}

// Runs of consecutive day numbers, from a sorted list of distinct day numbers.
function dayRuns(days: readonly number[]): Array<{ last: number; length: number }> {
  const runs: Array<{ last: number; length: number }> = [];
  for (const d of days) {
    const run = runs[runs.length - 1];
    if (run && d === run.last + 1) { run.last = d; run.length += 1; } else runs.push({ last: d, length: 1 });
  }
  return runs;
}

export function computeStats(input: readonly ResultRow[], opts: { tz: string; now: number }): ProfileStats {
  const rows = ordered(input);
  const done = rows.filter(finished);
  const wins = rows.filter((r) => r.outcome === 'won');
  const losses = rows.filter((r) => r.outcome === 'lost');
  const sum = (pick: (r: ResultRow) => number): number => rows.reduce((total, r) => total + pick(r), 0);
  const cardsPlayed = sum((r) => r.cardsPlayed);
  const totalMovement = sum((r) => r.totalMovement);

  let currentWin = 0;
  let bestWin = 0;
  for (const r of rows) {
    currentWin = r.outcome === 'won' ? currentWin + 1 : 0;
    bestWin = Math.max(bestWin, currentWin);
  }

  // A game dated after now (a wrong clock) counts in the totals but never extends a day streak.
  const days = [...new Set(done.filter((r) => r.endedAtMs <= opts.now).map((r) => localParts(r.endedAtMs, opts.tz).dayNumber))].sort((a, b) => a - b);
  const runs = dayRuns(days);
  const today = localParts(opts.now, opts.tz).dayNumber;
  const lastRun = runs[runs.length - 1];
  // A streak is still alive until the day after its last game is over.
  const currentDay = lastRun && lastRun.last >= today - 1 ? lastRun.length : 0;

  const min = (values: number[]): number | null => (values.length ? Math.min(...values) : null);
  const max = (values: number[]): number => (values.length ? Math.max(...values) : 0);

  return {
    totals: {
      games: rows.length, wins: wins.length, losses: losses.length, abandoned: rows.length - done.length,
      winRate: rate(wins.length, losses.length), cardsPlayed, backwardTens: sum((r) => r.specialPlays), totalMovement,
      avgMovementPerCard: cardsPlayed > 0 ? totalMovement / cardsPlayed : null, timePlayedMs: sum((r) => r.durationMs)
    },
    streaks: { currentWin, bestWin, currentDay, bestDay: max(runs.map((r) => r.length)) },
    records: {
      fastestWinMs: min(wins.map((r) => r.durationMs)),
      fewestCardsLeftInLoss: min(losses.map((r) => r.cardsLeft)),
      mostBackwardTens: max(done.map((r) => r.specialPlays)),
      longestGameMs: max(done.map((r) => r.durationMs)),
      biggestTableWon: max(wins.map((r) => r.playerCount))
    },
    breakdowns: {
      byMode: slices(rows, (r) => [r.mode, r.mode === 'solitaire' ? 'Solitaire' : 'Multiplayer']),
      byPlayerCount: slices(rows, (r) => [String(r.playerCount), r.playerCount === 1 ? '1 player' : `${r.playerCount} players`]).sort((a, b) => Number(a.key) - Number(b.key)),
      byDifficulty: slices(rows, (r) => [`${r.handSize}/${r.minCardsPerTurn}/${r.maxCard}`, `Hand ${r.handSize}, ${r.minCardsPerTurn} a turn, up to ${r.maxCard}`]),
      byRobots: slices(rows, (r) => r.robotCount === null ? ['unknown', 'Robots not recorded'] : r.robotCount === 0 ? ['none', 'No robots'] : ['some', 'With robots'])
    },
    cheats: { skips: sum((r) => r.skips), trades: sum((r) => r.trades), lookups: sum((r) => r.lookups), hints: sum((r) => r.hints) },
    trend: rows.slice(-20).map((r) => (r.outcome === 'won' ? 'W' : r.outcome === 'lost' ? 'L' : 'A'))
  };
}
