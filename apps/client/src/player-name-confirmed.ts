import { shortPlayerName } from '@upndown/shared-types';

const CONFIRMED_KEY = 'upndown.multiplayer.playerNameConfirmed.v1';

// A name is the player's own once they edited it or used it to create or join a game. An invite link joins
// at once only for such a name, so a first-time visitor sees the join screen and can change the generated
// one first. A name saved before this flag existed counts as theirs, unless it is a generated mash-up:
// those are saved from the first visit, without the player ever choosing them.
export function readNameConfirmed(savedName: string): boolean {
  try {
    if (window.localStorage.getItem(CONFIRMED_KEY) === '1') return true;
  } catch {
    return false;
  }
  return savedName.trim() !== '' && shortPlayerName(savedName) === savedName;
}

export function writeNameConfirmed(): void {
  try {
    window.localStorage.setItem(CONFIRMED_KEY, '1');
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory flag still holds for this visit.
  }
}
