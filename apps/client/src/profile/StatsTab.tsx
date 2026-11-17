import type { ProfileStats, Slice } from '@upndown/profile';
import type { ResultRow } from '@upndown/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { formatClock, formatPlayed, formatWhen, percent } from './format.js';
import type { ProfileSource } from './source.js';
import type { ProfileView } from './useProfile.js';

interface Props {
  view: ProfileView;
  tz: string;
  badgesEarned: number;
  onPlay: () => void;
  onOpenAchievements: () => void;
}

const WORD: Record<'W' | 'L' | 'A', string> = { W: 'Won', L: 'Lost', A: 'Abandoned' };

function SliceTable({ title, rows }: { title: string; rows: Slice[] }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="stats-table-wrap profile-breakdown">
      <table className="stats-table stack-on-phone">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Setting</th><th scope="col">Games</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col">Win rate</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td data-label="Games">{s.games}</td>
              <td data-label="Won">{s.wins}</td>
              <td data-label="Lost">{s.losses}</td>
              <td data-label="Win rate">{percent(s.winRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ source, tz, version }: { source: ProfileSource; tz: string; version: number }): JSX.Element {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback((cursor: string | null, replace: boolean): void => {
    setBusy(true);
    source.history(cursor).then((page) => {
      setRows((old) => (replace ? page.rows : [...old, ...page.rows]));
      setNext(page.next);
      setFailed(false);
    }, () => setFailed(true)).finally(() => setBusy(false));
  }, [source]);

  useEffect(() => { fetchPage(null, true); }, [fetchPage, version]);

  return (
    <section aria-labelledby="history-title" className="profile-history">
      <h3 id="history-title">History</h3>
      <ol className="history-list">
        {rows.map((r) => (
          <li key={r.gameId}>
            <span className="history-when">{formatWhen(r.endedAtMs, tz)}</span>
            <strong className={`history-outcome ${r.outcome}`}>{r.outcome === 'won' ? 'Won' : r.outcome === 'lost' ? 'Lost' : 'Abandoned'}</strong>
            <span>{r.mode === 'solitaire' ? 'Solitaire' : `${r.playerCount} players${r.robotCount ? `, ${r.robotCount} robot${r.robotCount === 1 ? '' : 's'}` : ''}`}</span>
            <span>{r.cardsPlayed} cards, {formatClock(r.durationMs)}</span>
          </li>
        ))}
      </ol>
      {failed ? <p role="alert">Could not load more games. <button type="button" className="link-action" onClick={() => fetchPage(next, rows.length === 0)}>Try again</button></p> : null}
      {next ? <button type="button" className="secondary" disabled={busy} onClick={() => fetchPage(next, false)}>Load more</button> : null}
    </section>
  );
}

function Tiles({ stats, badgesEarned, onOpenAchievements }: { stats: ProfileStats; badgesEarned: number; onOpenAchievements: () => void }): JSX.Element {
  const t = stats.totals;
  return (
    <div className="stats-tiles">
      <div className="stats-tile"><div className="stats-tile-value">{t.games}</div><div className="stats-tile-label">Games</div></div>
      <div className="stats-tile"><div className="stats-tile-value">{percent(t.winRate)}</div><div className="stats-tile-label">Win rate</div></div>
      <div className="stats-tile"><div className="stats-tile-value">{formatPlayed(t.timePlayedMs)}</div><div className="stats-tile-label">Time played</div></div>
      <div className="stats-tile"><div className="stats-tile-value">{stats.streaks.currentWin}</div><div className="stats-tile-label">Win streak (best {stats.streaks.bestWin})</div></div>
      <div className="stats-tile"><div className="stats-tile-value">{stats.streaks.currentDay}</div><div className="stats-tile-label">Day streak (best {stats.streaks.bestDay})</div></div>
      <button type="button" className="stats-tile stats-tile-button" onClick={onOpenAchievements}>
        <div className="stats-tile-value">{badgesEarned}</div><div className="stats-tile-label">Badges earned</div>
      </button>
    </div>
  );
}

export function StatsTab({ view, tz, badgesEarned, onPlay, onOpenAchievements }: Props): JSX.Element {
  const { data, state, source, reload } = view;
  if (state === 'error') {
    return <div className="profile-state"><p role="alert">Could not load your stats.</p><button type="button" className="secondary" onClick={reload}>Retry</button></div>;
  }
  if (!data) return <p className="profile-state" role="status">Loading your stats...</p>;
  const s = data.stats;
  const waiting = data.waiting > 0 ? <p className="profile-waiting" role="status">{data.waiting} {data.waiting === 1 ? 'game is' : 'games are'} waiting to sync.</p> : null;

  if (s.totals.games === 0) {
    return (
      <div className="profile-state">
        {waiting}
        <p>No games yet. Play one and your stats will show up here.</p>
        <button type="button" onClick={onPlay}>Play a game</button>
      </div>
    );
  }

  return (
    <div className="profile-stats">
      {waiting}
      <Tiles stats={s} badgesEarned={badgesEarned} onOpenAchievements={onOpenAchievements} />

      <section aria-labelledby="trend-title">
        <h3 id="trend-title">Last {s.trend.length} games</h3>
        <ol className="trend" aria-label="Results, oldest first">
          {s.trend.map((r, i) => <li key={i} className={`trend-${r}`}><span aria-hidden="true">{r}</span><span className="sr-only">{WORD[r]}</span></li>)}
        </ol>
        <p className="trend-legend">W won, L lost, A abandoned. Oldest on the left.</p>
      </section>

      <section aria-labelledby="totals-title">
        <h3 id="totals-title">Totals</h3>
        <dl className="profile-facts">
          <div><dt>Won, lost, abandoned</dt><dd>{s.totals.wins}, {s.totals.losses}, {s.totals.abandoned}</dd></div>
          <div><dt>Cards played</dt><dd>{s.totals.cardsPlayed.toLocaleString()}</dd></div>
          <div><dt>Backward 10s</dt><dd>{s.totals.backwardTens.toLocaleString()}</dd></div>
          <div><dt>Net movement</dt><dd>{s.totals.totalMovement.toLocaleString()}{s.totals.avgMovementPerCard !== null ? ` (${s.totals.avgMovementPerCard.toFixed(1)} a card)` : ''}</dd></div>
          <div><dt>Hints, skips, trades, lookups</dt><dd>{s.cheats.hints}, {s.cheats.skips}, {s.cheats.trades}, {s.cheats.lookups}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="records-title">
        <h3 id="records-title">Records</h3>
        <dl className="profile-facts">
          <div><dt>Fastest win</dt><dd>{s.records.fastestWinMs === null ? 'none yet' : formatClock(s.records.fastestWinMs)}</dd></div>
          <div><dt>Fewest cards left in a loss</dt><dd>{s.records.fewestCardsLeftInLoss ?? 'none yet'}</dd></div>
          <div><dt>Most backward 10s in a game</dt><dd>{s.records.mostBackwardTens}</dd></div>
          <div><dt>Longest game</dt><dd>{formatClock(s.records.longestGameMs)}</dd></div>
          <div><dt>Biggest table won</dt><dd>{s.records.biggestTableWon === 0 ? 'none yet' : `${s.records.biggestTableWon} ${s.records.biggestTableWon === 1 ? 'player' : 'players'}`}</dd></div>
        </dl>
      </section>

      <SliceTable title="By mode" rows={s.breakdowns.byMode} />
      <SliceTable title="By table size" rows={s.breakdowns.byPlayerCount} />
      <SliceTable title="By difficulty" rows={s.breakdowns.byDifficulty} />
      <SliceTable title="By robots" rows={s.breakdowns.byRobots} />

      {source ? <History source={source} tz={tz} version={data.stats.totals.games} /> : null}
    </div>
  );
}
