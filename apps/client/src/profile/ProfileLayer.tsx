import type { BadgeChange } from '@upndown/profile';
import { useEffect } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import type { LocalHistory } from './local-history.js';
import { ProfilePage, type ProfileTab } from './ProfilePage.js';
import { useProfile } from './useProfile.js';

interface Props {
  auth: AuthState;
  history: LocalHistory;
  open: boolean;
  seen: Record<string, number>;
  markSeen: (map: Record<string, number>) => void;
  // What the latest finished game changed, by badge id.
  lastGame: ReadonlyMap<string, BadgeChange>;
  // The tab is the parent's, so a badge toast can open the profile on the achievements.
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onClose: () => void;
  onChangeName?: (() => void) | undefined;
}

// The profile sheet and what it needs, kept out of App.tsx. Nothing loads until it is opened.
export function ProfileLayer({ auth, history, open, seen, markSeen, lastGame, tab, onTab, onClose, onChangeName }: Props): JSX.Element | null {
  const view = useProfile(auth, history, open);
  // Looking at the achievements is seeing them: what is shown there is not announced again later.
  useEffect(() => {
    if (!open || tab !== 'achievements' || !view.data) return;
    markSeen(Object.fromEntries(view.data.badges.filter((b) => b.tier > 0).map((b) => [b.id, b.tier])));
  }, [open, tab, view.data, markSeen]);
  if (!open) return null;
  return (
    <ProfilePage
      auth={auth}
      view={view}
      history={history}
      authEnabled={auth.status !== 'disabled'}
      seen={seen}
      lastGame={lastGame}
      tab={tab}
      onTab={onTab}
      onBack={onClose}
      onSignIn={auth.signIn}
      onPlay={onClose}
      onChangeName={onChangeName}
    />
  );
}
