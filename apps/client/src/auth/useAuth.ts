import { useCallback, useEffect, useState } from 'react';

export type LoginMessage = 'cancelled' | 'failed';

export interface AuthState {
  // 'loading' shows nothing at all, so a signed-in player never sees login buttons flash.
  status: 'loading' | 'disabled' | 'guest' | 'signedIn';
  playerName: string | null;
  loginMessage: LoginMessage | null;
  signIn: () => void;
  signOut: () => Promise<void>;
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
  const [loginMessage, setLoginMessage] = useState<LoginMessage | null>(null);

  useEffect(() => {
    setLoginMessage(takeLoginMessage());
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const config = await fetch('/api/auth/config', { ...sameOrigin, signal: controller.signal });
      if (!config.ok || (await config.json() as { enabled?: boolean }).enabled !== true) return setStatus('disabled');
      const me = await fetch('/api/me', { ...sameOrigin, signal: controller.signal });
      if (me.status === 401) return setStatus('guest');
      if (!me.ok) return setStatus('disabled');
      const body = await me.json() as { playerName?: string | null };
      setPlayerName(typeof body.playerName === 'string' ? body.playerName : null);
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
      setStatus('guest');
    }
  }, []);

  const dismissLoginMessage = useCallback(() => setLoginMessage(null), []);

  return { status, playerName, loginMessage, signIn, signOut, dismissLoginMessage };
}
