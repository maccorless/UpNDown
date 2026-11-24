import type { JSX } from 'react';
import type { SeatOffer } from './useSavedSeat.js';

// Games still being played that this browser holds a seat in. Shown on the front page and at the top of the Multiplayer screen,
// since that is where a player goes to play. A player who closed the browser mid-game should not have to know which one to click.
export function RejoinNotice({ seats, onRejoin }: { seats: SeatOffer[]; onRejoin: (seatKey: string) => void }): JSX.Element | null {
  if (seats.length === 0) return null;
  return (
    <section className="rejoin-notice" aria-label="games in progress">
      <p className="rejoin-notice-title">You have a game in progress.</p>
      {seats.map((seat) => (
        <button key={seat.seatKey} type="button" className="primary rejoin-button" onClick={() => onRejoin(seat.seatKey)} data-testid="rejoin-game">
          Rejoin game {seat.gameId}
        </button>
      ))}
    </section>
  );
}
