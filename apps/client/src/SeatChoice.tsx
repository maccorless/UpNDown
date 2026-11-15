import { Modal } from './Modal.js';

interface SeatChoiceProps {
  gameIds: string[];
  onChoose: (gameId: string) => void;
  onClose: () => void;
}

// A signed-in player who holds seats in more than one game being played chooses which to go back to.
export function SeatChoice({ gameIds, onChoose, onClose }: SeatChoiceProps): JSX.Element {
  return (
    <Modal className="panel seat-choice-modal" dismiss="any" label="choose a game to rejoin" onClose={onClose}>
      <h2>Which game?</h2>
      <p>Your account has a seat in more than one game that is still going.</p>
      <ul className="seat-choice-list">
        {gameIds.map((gameId) => (
          <li key={gameId}>
            <button type="button" className="secondary" data-testid="choose-seat" onClick={() => onChoose(gameId)}>Rejoin game {gameId}</button>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" className="secondary" data-autofocus onClick={onClose}>Not now</button>
      </div>
    </Modal>
  );
}
