import { shortPlayerName } from '@upndown/shared-types';
import { useState } from 'react';
import { Modal } from './Modal.js';
import { RejoinNotice } from './RejoinNotice.js';
import { SignInCard } from './auth/SignInCard.js';
import { describeAge, type SaveSummary } from './solitaire-save.js';
import type { SeatOffer } from './useSavedSeat.js';
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
  // Starts a new solitaire game.
  onSolitaire: () => void;
  // Solitaire games saved on this device that no other tab has open, and how to pick one up or throw it away.
  solitaireSaves: SaveSummary[];
  onResumeSolitaire: (runId: string) => void;
  onDiscardSolitaire: (runId: string) => void;
  onMultiplayer: () => void;
  // Games being played that this browser still has a seat in and no other tab has open, and how to go back to one.
  rejoinSeats: SeatOffer[];
  onRejoin: (seatKey: string) => void;
}

export function Landing({ auth, firstVisit, onSolitaire, solitaireSaves, onResumeSolitaire, onDiscardSolitaire, onMultiplayer, rejoinSeats, onRejoin }: LandingProps): JSX.Element {
  const [enter] = useState(() => {
    const first = !introPlayed;
    introPlayed = true;
    return first;
  });

  const [discarding, setDiscarding] = useState<SaveSummary | null>(null);

  return (
    <section className={`landing-hero${enter ? ' landing-enter' : ''}`} aria-label="Choose how to play">
      <p className="hero-tagline">A cooperative card game. Win together or lose together.</p>

      <RejoinNotice seats={rejoinSeats} onRejoin={onRejoin} />

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


      {solitaireSaves.map((save) => (
        <p className="resume-note" key={save.runId} data-testid="solitaire-save">
          Solitaire game saved on this device: {save.cardsLeft} cards left, {describeAge(save.savedAtMs)}.{' '}
          <button type="button" className="link-action" onClick={() => onResumeSolitaire(save.runId)} data-testid="continue-solitaire">Continue</button>
          {' '}
          <button type="button" className="link-action" onClick={() => setDiscarding(save)}>Discard</button>
        </p>
      ))}

      <div className="account-strip">
        <SignInCard auth={auth} />
        {auth.status === 'signedIn' ? (
          <p className="welcome">
            Welcome back, <strong>{auth.playerName ? shortPlayerName(auth.playerName) : 'player'}</strong>.
          </p>
        ) : null}
      </div>

      {discarding ? (
        // Discarding a saved game is not undoable, so it takes a second, deliberate step. Cancel is where focus starts.
        <Modal className="panel end-game-confirm-modal" dismiss="esc" label="discard a saved solitaire game" onClose={() => setDiscarding(null)}>
          <h2>Discard this game?</h2>
          <p>Your saved game, with {discarding.cardsLeft} cards left, will be thrown away.</p>
          <div className="button-row">
            <button type="button" className="secondary" data-autofocus onClick={() => setDiscarding(null)}>Keep my saved game</button>
            <button type="button" className="danger" onClick={() => { onDiscardSolitaire(discarding.runId); setDiscarding(null); }}>Discard</button>
          </div>
        </Modal>
      ) : null}

      {firstVisit ? <p className="landing-hint">First time here? Open How to Play above.</p> : null}
    </section>
  );
}
