import { useEffect, useState } from 'react';
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
  onClose: () => void;
  onChangeName?: (() => void) | undefined;
}

// The profile sheet and what it needs, kept out of App.tsx. Nothing loads until it is opened.
export function ProfileLayer({ auth, history, open, seen, markSeen, onClose, onChangeName }: Props): JSX.Element | null {
  const [tab, setTab] = useState<ProfileTab>('stats');
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
      tab={tab}
      onTab={setTab}
      onBack={onClose}
      onSignIn={auth.signIn}
      onPlay={onClose}
      onChangeName={onChangeName}
    />
  );
}
