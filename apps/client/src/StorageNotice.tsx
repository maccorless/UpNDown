import type { AuthState } from './auth/useAuth.js';

// Said once, plainly, when the server cannot save: a game in progress may not survive a restart, and sign-in and results are
// not available. Solitaire is not affected, so it says so. Nothing is shown when saving works, or when we were not told.
export function StorageNotice({ storage }: { storage: AuthState['storage'] }): JSX.Element | null {
  if (storage !== 'down' && storage !== 'none') return null;
  return (
    <p className="storage-notice" data-testid="storage-notice">
      {storage === 'down'
        ? 'Saving is unavailable right now. You can keep playing, and solitaire is not affected, but sign-in and results are paused, and a game in progress may be lost if the server restarts.'
        : 'This version has no database, so sign-in, results and getting a game back after a restart are not available. You can still play, and solitaire is not affected.'}
    </p>
  );
}
