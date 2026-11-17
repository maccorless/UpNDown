import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import type { HistoryStatus, LocalHistory } from './local-history.js';
import { createOutbox } from './outbox.js';
import { accountSource, localSource, type ProfileData, type ProfileSource } from './source.js';

export const deviceTimeZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

export interface ProfileView {
  source: ProfileSource | null;
  state: 'loading' | 'ready' | 'error';
  data: ProfileData | null;
  reload: () => void;
  // How the device is keeping a guest's history. Always 'ok' for an account.
  storageStatus: HistoryStatus;
}

// The profile for whoever is here: the device's for a guest, the account's for a signed-in player. Nothing loads until `enabled`
// (the page is open), and a guest's page refreshes when its history changes.
export function useProfile(auth: AuthState, history: LocalHistory, enabled: boolean): ProfileView {
  const signedIn = auth.status === 'signedIn';
  const known = auth.status !== 'loading';
  const source = useMemo<ProfileSource | null>(() => {
    if (!known) return null;
    return signedIn ? accountSource(createOutbox(auth.userId ?? 'unknown')) : localSource(history);
  }, [known, signedIn, auth.userId, history]);
  const [data, setData] = useState<ProfileData | null>(null);
  const [state, setState] = useState<ProfileView['state']>('loading');
  const [version, setVersion] = useState(0);
  const [storageStatus, setStorageStatus] = useState<HistoryStatus>('ok');

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!enabled || !source) return undefined;
    let cancelled = false;
    setState('loading');
    source.load(deviceTimeZone()).then((loaded) => {
      if (cancelled) return;
      setData(loaded);
      setState('ready');
      setStorageStatus(signedIn ? 'ok' : history.load().status);
    }, () => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [enabled, source, version, signedIn, history]);

  useEffect(() => (enabled && !signedIn ? history.subscribe(reload) : undefined), [enabled, signedIn, history, reload]);

  return { source, state, data, reload, storageStatus };
}
