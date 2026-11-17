import { useState } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import type { LocalHistory } from './local-history.js';
import { ProfilePage, type ProfileTab } from './ProfilePage.js';
import { useProfile } from './useProfile.js';

interface Props {
  auth: AuthState;
  history: LocalHistory;
  open: boolean;
  seen: Record<string, number>;
  onClose: () => void;
}

// The profile sheet and what it needs, kept out of App.tsx. Nothing loads until it is opened.
export function ProfileLayer({ auth, history, open, seen, onClose }: Props): JSX.Element | null {
  const [tab, setTab] = useState<ProfileTab>('stats');
  const view = useProfile(auth, history, open);
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
    />
  );
}
