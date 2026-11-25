import { CATALOG, CATEGORY_LABELS, type BadgeChange, type BadgeState, type Badge, type Category } from '@upndown/profile';
import { useState, type ReactNode } from 'react';
import { formatClock, formatDay } from './format.js';

interface Props {
  badges: BadgeState[];
  // Tier already shown to the player, by badge id. A badge never shows lower than it was shown.
  seen: Record<string, number>;
  tz: string;
  // What the latest finished game changed, by badge id: shown as a highlight, and the progress it moved shows the old value struck through.
  lastGame: ReadonlyMap<string, BadgeChange>;
}

type Filter = 'all' | 'earned' | 'progress';
const ORDER: Category[] = ['playing', 'winning', 'backward', 'table', 'helpers', 'time', 'secret'];
const TIER = ['Locked', 'Bronze', 'Silver', 'Gold'] as const;
const GLYPH = ['', '●', '◆', '★'];

interface Row { badge: Badge; state: BadgeState; tier: number }

const isTiered = (b: Badge): boolean => b.targets.length > 1;

// A value the newest game moved shows the old one struck through, then the new one, so the game's effect is visible. Read aloud
// as "was 40, now 45". A value it did not move is plain text.
function valuePart(value: number | null, change: BadgeChange | undefined, format: (n: number) => string, none: string): ReactNode {
  const now = value === null ? none : format(value);
  if (!change || change.from === change.to) return now;
  const was = change.from === null ? none : format(change.from);
  return <><s><span className="sr-only">was </span>{was}</s> <span className="sr-only">now </span>{now}</>;
}

function progressText(r: Row, change?: BadgeChange): ReactNode {
  const { badge, state } = r;
  const v = state.progress.value;
  const next = state.progress.nextTarget;
  if (badge.direction === 'atMost') {
    return <>Best: {valuePart(v, change, formatClock, 'none yet')}{next !== null ? `. Next: under ${formatClock(next)}` : ''}</>;
  }
  if (!isTiered(badge)) return r.tier >= 1 ? 'Earned' : 'Not yet';
  const shown = valuePart(v ?? 0, change, String, '0');
  return next === null ? <>{shown}, all tiers earned</> : <>{shown} / {next}</>;
}

export function AchievementsTab({ badges, seen, tz, lastGame }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const rows: Row[] = CATALOG.map((badge) => {
    const state = badges.find((b) => b.id === badge.id) ?? { id: badge.id, tier: 0 as const, progress: { value: 0, nextTarget: badge.targets[0] ?? null }, unlockedAtMs: [] };
    return { badge, state, tier: Math.min(badge.targets.length, Math.max(state.tier, seen[badge.id] ?? 0)) };
  });
  const earned = rows.filter((r) => r.tier >= 1).length;
  const gold = rows.filter((r) => isTiered(r.badge) && r.tier === 3).length;
  const almost = rows
    .filter((r) => r.badge.direction === 'atLeast' && r.tier < r.badge.targets.length && r.state.progress.nextTarget !== null && (r.state.progress.value ?? 0) > 0 && !(r.badge.secret && r.tier === 0))
    .map((r) => ({ r, ratio: (r.state.progress.value ?? 0) / r.state.progress.nextTarget! }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);
  const shown = (r: Row): boolean => filter === 'all' || (filter === 'earned' ? r.tier >= 1 : r.tier < r.badge.targets.length);

  const card = (r: Row): JSX.Element => {
    const hidden = r.badge.secret && r.tier === 0;
    const label = r.tier === 0 ? 'Locked' : isTiered(r.badge) ? TIER[r.tier]! : 'Earned';
    const next = r.state.progress.nextTarget;
    const value = r.state.progress.value;
    const change = hidden ? undefined : lastGame.get(r.badge.id);
    return (
      <li key={r.badge.id} className={`badge-card tier-${r.tier}${hidden ? ' secret' : ''}${change ? ' is-changed' : ''}`}>
        <span className="badge-medal" aria-hidden="true" data-tier={r.tier}>{r.tier === 0 ? '?' : isTiered(r.badge) ? GLYPH[r.tier] : '✓'}</span>
        <div className="badge-body">
          <h4>{hidden ? '???' : r.badge.name}</h4>
          <p>{hidden ? `A secret badge. ${r.badge.hint ?? ''}` : r.badge.blurb}</p>
          <p className="badge-tier"><strong>{label}</strong>{r.state.unlockedAtMs.map((t, i) => (t === null ? null : <span key={i}>{isTiered(r.badge) ? ` ${TIER[i + 1]} ${formatDay(t, tz)}` : ` ${formatDay(t, tz)}`}</span>))}</p>
          {change ? <p className="badge-new">{change.tierUp ? 'New in your last game' : 'Moved in your last game'}</p> : null}
          {!hidden && isTiered(r.badge) && r.badge.direction === 'atLeast' && next !== null ? (
            <p className="badge-progress">
              <progress max={next} value={Math.min(value ?? 0, next)} aria-label={`${r.badge.name} progress`} /> <span>{progressText(r, change)}</span>
            </p>
          ) : null}
          {!hidden && r.badge.direction === 'atMost' ? <p className="badge-progress">{progressText(r, change)}</p> : null}
          {!hidden && isTiered(r.badge) && r.badge.direction === 'atLeast' && next === null ? <p className="badge-progress">{progressText(r, change)}</p> : null}
        </div>
      </li>
    );
  };

  return (
    <div className="profile-achievements">
      <p className="achievements-summary" role="status">{earned} of {rows.length} earned, {gold} gold</p>

      {almost.length > 0 ? (
        <section aria-labelledby="almost-title">
          <h3 id="almost-title">Almost there</h3>
          <ul className="badge-list">{almost.map(({ r }) => card(r))}</ul>
        </section>
      ) : null}

      <div role="group" aria-label="Show badges" className="badge-filters">
        {(['all', 'earned', 'progress'] as const).map((f) => (
          <button key={f} type="button" className="secondary" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'earned' ? 'Earned' : 'In progress'}</button>
        ))}
      </div>

      {ORDER.map((category) => {
        const inCategory = rows.filter((r) => r.badge.category === category && shown(r));
        if (inCategory.length === 0) return null;
        return (
          <section key={category} aria-labelledby={`cat-${category}`}>
            <h3 id={`cat-${category}`}>{CATEGORY_LABELS[category]}</h3>
            <ul className="badge-list">{inCategory.map(card)}</ul>
          </section>
        );
      })}
    </div>
  );
}
