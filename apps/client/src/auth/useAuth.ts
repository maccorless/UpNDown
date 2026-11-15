import { storedSettingsSchema, type StoredSettings } from '@upndown/shared-types';
import { useCallback, useEffect, useState } from 'react';

export type LoginMessage = 'cancelled' | 'failed';

export interface AuthState {
  // 'loading' shows nothing at all, so a signed-in player never sees login buttons flash.
  status: 'loading' | 'disabled' | 'guest' | 'signedIn';
  // Whether the server can save: 'none' (no database in this version), 'ok', 'down' (not answering right now), or 'unknown'
  // (not told, for example offline or an older server).
  storage: 'unknown' | 'none' | 'ok' | 'down';
  playerName: string | null;
  // False until the player has typed a name or accepted the suggested one, which is what the first-sign-in prompt asks.
  nameConfirmed: boolean;
  // The account's stored document from /api/me. Null when signed out or the server sent nothing usable.
  settings: StoredSettings | null;
  loginMessage: LoginMessage | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  // Saves the name the player chose (or accepted) and marks it theirs. Resolves to the saved name, or null if it failed.
  confirmName: (name: string) => Promise<string | null>;
  dismissLoginMessage: () => void;
}

const sameOrigin = { credentials: 'same-origin' } as const;

// The server redirects a failed login to /?login=cancelled or /?login=failed. Read it once and clean the address.
function takeLoginMessage(): LoginMessage | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('login');
  if (value === null) return null;
  url.searchParams.delete('login');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return value === 'cancelled' || value === 'failed' ? value : null;
}

export function useAuth(navigate: (url: string) => void = (url) => window.location.assign(url)): AuthState {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [nameConfirmed, setNameConfirmed] = useState(true);
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [loginMessage, setLoginMessage] = useState<LoginMessage | null>(null);
  const [storage, setStorage] = useState<AuthState['storage']>('unknown');

  useEffect(() => {
    setLoginMessage(takeLoginMessage());
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const config = await fetch('/api/auth/config', { ...sameOrigin, signal: controller.signal });
      if (!config.ok) return setStatus('disabled');
      const configBody = await config.json() as { enabled?: boolean; storage?: string };
      if (configBody.storage === 'none' || configBody.storage === 'ok' || configBody.storage === 'down') setStorage(configBody.storage);
      if (configBody.enabled !== true) return setStatus('disabled');
      const me = await fetch('/api/me', { ...sameOrigin, signal: controller.signal });
      if (me.status === 401) return setStatus('guest');
      if (!me.ok) return setStatus('disabled');
      const body = await me.json() as { playerName?: string | null; nameConfirmed?: boolean; settings?: unknown };
      setPlayerName(typeof body.playerName === 'string' ? body.playerName : null);
      // A server that does not say (an older one) must not trigger a prompt it cannot answer.
      setNameConfirmed(body.nameConfirmed !== false);
      const parsed = storedSettingsSchema.safeParse(body.settings);
      setSettings(parsed.success ? parsed.data : null);
      return setStatus('signedIn');
    };
    // Any failure (offline, an old server, the client page served for an unknown path) means plain guest play.
    load().catch(() => { if (!controller.signal.aborted) setStatus('disabled'); });
    return () => controller.abort();
  }, []);

  const signIn = useCallback(() => {
    navigate(`/auth/google/start?return=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [navigate]);

  const signOut = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      ...sameOrigin,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (response.ok) {
      setPlayerName(null);
      setNameConfirmed(true);
      setSettings(null);
      setStatus('guest');
    }
  }, []);

  const confirmName = useCallback(async (name: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/me/name', {
        ...sameOrigin,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name })
      });
      if (!response.ok) return null;
      const saved = (await response.json() as { playerName?: string }).playerName;
      if (typeof saved !== 'string') return null;
      setPlayerName(saved);
      setNameConfirmed(true);
      setSettings((current) => (current ? { ...current, playerName: saved } : current));
      return saved;
    } catch {
      return null;
    }
  }, []);

  const dismissLoginMessage = useCallback(() => setLoginMessage(null), []);

  return { status, storage, playerName, nameConfirmed, settings, loginMessage, signIn, signOut, confirmName, dismissLoginMessage };
}
