import { shortPlayerName } from '@upndown/shared-types';

const MAX_NAME_LENGTH = 32;

// What a joiner is called in a game: "Donald Washington" becomes "Donald W", and a name another player
// already has (compared as shown, ignoring case) gets "-1", then "-2" and so on. The base is trimmed to fit
// the 32 character limit. The first player to take a name keeps it as typed.
export function uniqueInGameName(desired: string, takenNames: readonly string[]): string {
  const base = shortPlayerName(desired.trim());
  const taken = new Set(takenNames.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
