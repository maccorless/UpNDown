import { GoogleG } from '../auth/SignInCard.js';
import { LOCAL_HISTORY_CAP, LOCAL_HISTORY_WARN_AT, type HistoryStatus } from './local-history.js';

interface Props {
  authEnabled: boolean;
  storageStatus: HistoryStatus;
  games: number;
  onSignIn: () => void;
}

// Shown above a guest's profile, always. A guest's history lives in this browser and nowhere else, and the page says so.
export function GuestBanner({ authEnabled, storageStatus, games, onSignIn }: Props): JSX.Element {
  const signInButton = authEnabled ? (
    <button type="button" className="google-signin" onClick={onSignIn}><GoogleG /><span>Sign in with Google</span></button>
  ) : null;

  const storageProblem = storageStatus === 'memory'
    ? 'Your browser is blocking storage, so your stats last only until you close this tab.'
    : storageStatus === 'full' ? 'This device is out of storage, so new games cannot be saved here.' : null;
  const capNote = games >= LOCAL_HISTORY_CAP
    ? `The history on this device is full (${LOCAL_HISTORY_CAP.toLocaleString()} games), so new games are not saved here.${authEnabled ? ' Signing in keeps going.' : ''}`
    : games >= LOCAL_HISTORY_WARN_AT ? `This device holds ${games.toLocaleString()} of ${LOCAL_HISTORY_CAP.toLocaleString()} games of history.${authEnabled ? ' Signing in keeps going.' : ''}` : null;

  return (
    <section className="guest-banner" aria-labelledby="guest-banner-title">
      {storageStatus === 'corrupt-reset' ? <p className="guest-banner-note" role="status">The history saved on this device could not be read, so a fresh one was started. A copy of the old data was kept.</p> : null}
      {authEnabled ? (
        <>
          <h3 id="guest-banner-title">Your profile lives only in this browser.</h3>
          {storageProblem ? <p>{storageProblem}</p> : null}
          {storageStatus === 'memory' || storageStatus === 'full' ? (
            <p>Signing in will not bring this history along, because this browser cannot keep it. Games you finish after signing in are saved to your account.</p>
          ) : (
            <p>Your stats, profile and achievements will be lost if you clear your browser data, switch browser or device, or reset this device. Sign in with Google to keep them. Everything you have so far comes with you.</p>
          )}
          {capNote ? <p>{capNote}</p> : null}
          {signInButton}
        </>
      ) : (
        <>
          <h3 id="guest-banner-title">Stats are saved on this device.</h3>
          {storageProblem ? <p>{storageProblem}</p> : null}
          {capNote ? <p>{capNote}</p> : null}
        </>
      )}
    </section>
  );
}
