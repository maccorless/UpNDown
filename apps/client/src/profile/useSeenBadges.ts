import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import type { LocalHistory } from './local-history.js';

const merge = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [id, tier] of Object.entries(b)) out[id] = Math.max(out[id] ?? 0, tier);
  return out;
};

// The badge tiers the player has been shown. A guest's are kept on the device with their games; a signed-in player's travel with
// the account's settings. Never mixed: signing out must not hand the account's badges to the guest profile on that device.
export function useSeenBadges(auth: AuthState, history: LocalHistory): { seen: Record<string, number>; markSeen: (map: Record<string, number>) => void } {
  const signedIn = auth.status === 'signedIn';
  const [seen, setSeen] = useState<Record<string, number>>(() => history.seen());
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  useEffect(() => {
    if (auth.status === 'guest' || auth.status === 'disabled') setSeen(history.seen());
    else if (auth.status === 'signedIn') setSeen(auth.settings?.seenBadges ?? {});
  }, [auth.status, auth.settings, history]);

  const markSeen = useCallback((map: Record<string, number>): void => {
    setSeen((current) => merge(current, map));
    if (!signedInRef.current) history.setSeen(map);
  }, [history]);

  return { seen, markSeen };
}
