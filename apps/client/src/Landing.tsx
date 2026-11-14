import { shortPlayerName } from '@upndown/shared-types';
import { useState } from 'react';
import { SignInCard } from './auth/SignInCard.js';
import type { AuthState } from './auth/useAuth.js';

// The staged entrance plays once per page load. Coming back to the landing from a game must not replay it.
let introPlayed = false;

// A little pile: the numbers a pile counts through, so each card says what you will be playing.
function Chips({ values, direction }: { values: number[]; direction: 'up' | 'down' }): JSX.Element {
  return (
    <span className={`chips chips-${direction}`} aria-hidden="true">
      {values.map((value, index) => (
        <span key={value} className="chip" style={{ '--i': index } as React.CSSProperties}>{value}</span>
      ))}
    </span>
  );
}

interface LandingProps {
  auth: AuthState;
  firstVisit: boolean;
  onSolitaire: () => void;
  onMultiplayer: () => void;
  onChangeName: () => void;
}

export function Landing({ auth, firstVisit, onSolitaire, onMultiplayer, onChangeName }: LandingProps): JSX.Element {
  const [enter] = useState(() => {
    const first = !introPlayed;
    introPlayed = true;
    return first;
  });

  return (
    <section className={`landing-hero${enter ? ' landing-enter' : ''}`} aria-label="Choose how to play">
      <p className="hero-tagline">A cooperative card game. Win together or lose together.</p>

      <div className="mode-cards">
        <button type="button" className="mode-card" onClick={onSolitaire} data-testid="mode-solitaire">
          <Chips values={[1, 34, 67]} direction="up" />
          <span className="mode-card-title">Solitaire</span>
          <span className="mode-card-desc">Play on your own. No sign-in, no waiting.</span>
        </button>
        <button type="button" className="mode-card mode-card-primary" onClick={onMultiplayer} data-testid="mode-multiplayer">
          <Chips values={[100, 66, 33]} direction="down" />
          <span className="mode-card-title">Multiplayer</span>
          <span className="mode-card-desc">Host a table or join friends. 2 to 6 players.</span>
        </button>
      </div>

      <div className="account-strip">
        <SignInCard auth={auth} />
        {auth.status === 'signedIn' ? (
          <p className="welcome">
            Welcome back, <strong>{auth.playerName ? shortPlayerName(auth.playerName) : 'player'}</strong>.{' '}
            <button type="button" className="link-action" onClick={onChangeName}>Change name</button>
          </p>
        ) : null}
      </div>

      {firstVisit ? <p className="landing-hint">First time here? Open How to Play above.</p> : null}
    </section>
  );
}
