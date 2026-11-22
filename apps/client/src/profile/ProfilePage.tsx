import { CATALOG } from '@upndown/profile';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import { Modal } from '../Modal.js';
import { AchievementsTab } from './AchievementsTab.js';
import { GuestBanner } from './GuestBanner.js';
import type { LocalHistory } from './local-history.js';
import { StatsTab } from './StatsTab.js';
import { deviceTimeZone, type ProfileView } from './useProfile.js';

export type ProfileTab = 'stats' | 'achievements';

interface Props {
  auth: AuthState;
  view: ProfileView;
  history: LocalHistory;
  authEnabled: boolean;
  // Badge tiers the player has already been shown, by id.
  seen: Record<string, number>;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onBack: () => void;
  onSignIn: () => void;
  onPlay: () => void;
  // Opens the name dialog. Absent where it cannot be asked for (in a game), and for a guest, whose name is the one typed in the multiplayer lobby.
  onChangeName?: (() => void) | undefined;
}

const TABS: Array<{ id: ProfileTab; label: string }> = [{ id: 'stats', label: 'Statistics' }, { id: 'achievements', label: 'Achievements' }];

// The player's profile as a full-screen sheet over whatever they were doing, so a game in progress keeps running underneath.
export function ProfilePage({ auth, view, history, authEnabled, seen, tab, onTab, onBack, onSignIn, onPlay, onChangeName }: Props): JSX.Element {
  const titleId = useId();
  const tz = deviceTimeZone();
  const signedIn = auth.status === 'signedIn';
  const [erasing, setErasing] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const badges = view.data?.badges ?? [];
  const earned = badges.filter((b) => b.tier >= 1).length;
  const unseen = badges.filter((b) => b.tier > (seen[b.id] ?? 0)).length;
  const games = view.data?.stats.totals.games ?? 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = TABS.length - 1;
    const to = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index + last) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    onTab(TABS[to]!.id);
    tabRefs.current[to]?.focus();
  };

  return (
    <Modal className="profile-page" dismiss="esc" onClose={onBack} labelledBy={titleId}>
      <header className="profile-head">
        <button type="button" className="secondary" onClick={onBack}>Back</button>
        <div>
          <h2 id={titleId}>Your profile</h2>
          <p className="profile-identity">
            {signedIn ? `${auth.playerName ?? 'Signed in'}, signed in with Google` : 'Guest on this device'}
            {!signedIn ? <span className="profile-chip">This device only</span> : null}
            {signedIn && onChangeName ? <>{' '}<button type="button" className="link-action" onClick={onChangeName}>Change name</button></> : null}
          </p>
        </div>
      </header>

      {!signedIn && auth.status !== 'loading' ? <GuestBanner authEnabled={authEnabled} storageStatus={view.storageStatus} games={games} onSignIn={onSignIn} /> : null}

      <div role="tablist" aria-label="Profile sections" className="profile-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`profile-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`profile-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.id === 'achievements' && unseen > 0 ? `${t.label}, ${unseen} new` : t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="profile-panel-stats" aria-labelledby="profile-tab-stats" hidden={tab !== 'stats'}>
        {tab === 'stats' ? <StatsTab view={view} tz={tz} badgesEarned={earned} onPlay={onPlay} onOpenAchievements={() => onTab('achievements')} /> : null}
      </div>
      <div role="tabpanel" id="profile-panel-achievements" aria-labelledby="profile-tab-achievements" hidden={tab !== 'achievements'}>
        {tab === 'achievements' ? (
          view.state === 'error' ? <div className="profile-state"><p role="alert">Could not load your achievements.</p><button type="button" className="secondary" onClick={view.reload}>Retry</button></div>
            : view.data ? <AchievementsTab badges={view.data.badges} seen={seen} tz={tz} /> : <p className="profile-state" role="status">Loading your achievements...</p>
        ) : null}
      </div>

      {!signedIn ? (
        <footer className="profile-foot">
          <button type="button" className="secondary" onClick={() => setErasing(true)}>Erase history on this device</button>
        </footer>
      ) : null}

      {erasing ? (
        <Modal className="confirm-dialog" dismiss="esc" onClose={() => setErasing(false)} label="Erase history on this device?">
          <h3>Erase history on this device?</h3>
          <p>This deletes {games} {games === 1 ? 'game' : 'games'} and your badges from this browser. It cannot be undone.</p>
          <div className="confirm-actions">
            <button type="button" className="secondary" data-autofocus onClick={() => setErasing(false)}>Cancel</button>
            <button type="button" className="danger" onClick={() => { history.clear(); setErasing(false); view.reload(); }}>Erase</button>
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}

export const BADGE_TOTAL = CATALOG.length;
