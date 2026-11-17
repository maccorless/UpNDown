import { cleanPlayerName, type GameSettings, type StoredSettings } from '@upndown/shared-types';
import { useEffect, useRef } from 'react';
import type { AuthState } from './useAuth.js';

export interface SyncState {
  playerName: string;
  setPlayerName: (name: string) => void;
  solitaire: GameSettings;
  setSolitaire: (settings: GameSettings) => void;
  multiplayer: GameSettings;
  setMultiplayer: (settings: GameSettings) => void;
  enableSounds: boolean;
  setEnableSounds: (on: boolean) => void;
  // Badges the player has been shown. Sent with the rest of the document when there are any.
  seenBadges?: Record<string, number>;
}

const DEBOUNCE_MS = 800;

// Fixed key order, so two equal documents always stringify equal and "unchanged" can be a string compare.
const documentOf = (name: string, s: Pick<SyncState, 'solitaire' | 'multiplayer' | 'enableSounds' | 'seenBadges'>): StoredSettings => ({
  playerName: name,
  solitaire: s.solitaire,
  multiplayer: s.multiplayer,
  enableSounds: s.enableSounds,
  ...(s.seenBadges && Object.keys(s.seenBadges).length > 0 ? { seenBadges: s.seenBadges as Record<string, 1 | 2 | 3> } : {})
});

const mergeSeen = (a: Record<string, number>, b: Record<string, number> | undefined): Record<string, number> => {
  const out = { ...a };
  for (const [id, tier] of Object.entries(b ?? {})) out[id] = Math.max(out[id] ?? 0, tier);
  return out;
};

async function putSettings(doc: StoredSettings): Promise<boolean> {
  try {
    const response = await fetch('/api/me/settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    if (!response.ok) console.warn(`Saving settings failed: ${response.status}`);
    return response.ok;
  } catch (err) {
    console.warn('Saving settings failed', err);
    return false;
  }
}

// Account settings follow design section 8. The first time per page load that the account is known, the
// server's settings replace the local copy, or, when it has none, the local copy is uploaded in one PUT.
// After that every change is sent whole, debounced, last write wins. Play never waits on any of it.
export function useAccountSync(auth: AuthState, state: SyncState): void {
  const latest = useRef(state);
  latest.current = state;
  const initialised = useRef(false);
  const lastSent = useRef<string | null>(null);
  const lastValidName = useRef<string | null>(null);
  // Badges the account already had when this page loaded. They are always sent back, so a device that knows fewer cannot erase them.
  const accountSeen = useRef<Record<string, number>>({});

  // An emptied or all-control-character field keeps the last good name instead of being sent or dropping the name.
  const typed = cleanPlayerName(state.playerName);
  const name = typed || lastValidName.current || '';
  if (typed) lastValidName.current = typed;
  const doc = documentOf(name, { ...state, seenBadges: mergeSeen(accountSeen.current, state.seenBadges) });
  const docJson = JSON.stringify(doc);

  useEffect(() => {
    if (auth.status !== 'signedIn') return undefined;

    if (!initialised.current) {
      initialised.current = true;
      const server = auth.settings;
      accountSeen.current = server?.seenBadges ?? {};
      const accountName = auth.playerName ?? name;
      const hasServerSettings = !!server && (server.solitaire !== undefined || server.multiplayer !== undefined || server.enableSounds !== undefined);
      const merged = documentOf(accountName, {
        solitaire: server?.solitaire ?? latest.current.solitaire,
        multiplayer: server?.multiplayer ?? latest.current.multiplayer,
        enableSounds: server?.enableSounds ?? latest.current.enableSounds,
        // What the account already says wins at the start, so the first save cannot wipe it.
        seenBadges: mergeSeen(server?.seenBadges ?? {}, latest.current.seenBadges)
      });
      lastValidName.current = accountName;
      // Recorded before the state updates land, so the re-render they cause is not mistaken for a user change.
      lastSent.current = JSON.stringify(merged);
      latest.current.setPlayerName(accountName);
      if (hasServerSettings) {
        if (server.solitaire) latest.current.setSolitaire(server.solitaire);
        if (server.multiplayer) latest.current.setMultiplayer(server.multiplayer);
        if (server.enableSounds !== undefined) latest.current.setEnableSounds(server.enableSounds);
      } else {
        void putSettings(merged).then((ok) => { if (!ok) lastSent.current = null; });
      }
      return undefined;
    }

    if (docJson === lastSent.current || !name) return undefined;
    const timer = setTimeout(() => {
      const previous = lastSent.current;
      lastSent.current = docJson;
      void putSettings(doc).then((ok) => { if (!ok) lastSent.current = previous; });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `doc` is derived from docJson, so docJson alone says when it changed.
  }, [auth.status, docJson]);
}
