// Reading and writing the game id and invitation in the page address.
export const GAME_QUERY_PARAM = 'game';
export const INVITE_QUERY_PARAM = 'invite';

export function normalizeGameId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : null;
}

export function readGameIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  return normalizeGameId(params.get(GAME_QUERY_PARAM));
}

export function buildInviteLink(gameId: string, inviteToken?: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set(GAME_QUERY_PARAM, gameId);
  if (inviteToken) url.searchParams.set(INVITE_QUERY_PARAM, inviteToken);
  return url.toString();
}

// The single-use invitation in the address, if there is one and it looks like one.
export function readInviteFromLocation(): string | null {
  const value = new URLSearchParams(window.location.search).get(INVITE_QUERY_PARAM);
  return value && /^[A-Za-z0-9_-]{16,100}$/.test(value) ? value : null;
}

export function syncGameIdInUrl(gameId: string | null): void {
  const url = new URL(window.location.href);
  if (gameId) {
    url.searchParams.set(GAME_QUERY_PARAM, gameId);
  } else {
    url.searchParams.delete(GAME_QUERY_PARAM);
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
