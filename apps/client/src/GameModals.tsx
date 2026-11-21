import { Modal } from './Modal.js';

// Small confirmations shown over a multiplayer game. They hold no state: the page passes in what to show and what to do.

export function EndGameConfirmModal(props: { pending: boolean; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  return (
    <Modal className="panel end-game-confirm-modal" dismiss="esc" label="confirm end game" onClose={props.onCancel}>
      <h2>End Game?</h2>
      <p>This will end the active game for all players and return everyone to the lobby.</p>
      <div className="button-row">
        <button type="button" className="danger" onClick={props.onConfirm} disabled={props.pending}>
          {props.pending ? 'Ending...' : 'End Game'}
        </button>
        <button type="button" className="secondary" data-autofocus onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function HostEndedModal(props: { gameId: string; pending: boolean; onAcknowledge: () => void }): JSX.Element {
  return (
    <Modal className="panel host-ended-modal" dismiss="none" label="host ended the game" onClose={() => undefined}>
      <h2>Host Ended The Game</h2>
      <p>The host ended game {props.gameId}. Return to home to join or host another game.</p>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onAcknowledge} disabled={props.pending}>
          {props.pending ? 'Returning...' : 'Back To Home'}
        </button>
      </div>
    </Modal>
  );
}

export function BackToLobbyModal(props: { pending: boolean; onBack: () => void; onLeave: () => void }): JSX.Element {
  return (
    <Modal className="panel host-ended-modal" dismiss="none" label="host returned to lobby" onClose={() => undefined}>
      <h2>Back to Lobby?</h2>
      <p>The host has returned to the lobby. Join them for another round, or leave.</p>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onBack}>
          Back to Lobby
        </button>
        <button type="button" className="secondary" onClick={props.onLeave} disabled={props.pending}>
          {props.pending ? 'Leaving...' : 'Leave'}
        </button>
      </div>
    </Modal>
  );
}

export function CardLookupModal(props: { value: string; onChange: (value: string) => void; onSubmit: () => void; onClose: () => void }): JSX.Element {
  return (
    <Modal className="panel card-lookup-modal" dismiss="any" label="card lookup" onClose={props.onClose}>
      <h2>Card Lookup</h2>
      <p>Enter a card number to see where it is.</p>
      <input
        className="card-lookup-input"
        type="number"
        min={1}
        max={999}
        value={props.value}
        autoFocus
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            props.onSubmit();
          } else if (e.key === 'Escape') {
            props.onClose();
          }
        }}
        placeholder="e.g. 34"
      />
      <div className="button-row">
        <button type="button" className="secondary" onClick={props.onClose}>Cancel</button>
        <button type="button" className="primary" disabled={!props.value} onClick={() => props.onSubmit()}>
          Look Up
        </button>
      </div>
    </Modal>
  );
}

export function KickedModal(props: { gameId: string; whileAway: boolean; onBackHome: () => void }): JSX.Element {
  return (
    <Modal className="panel host-ended-modal" dismiss="none" label="kicked from game" onClose={() => undefined}>
      <h2>Kicked From Game</h2>
      <p>{props.whileAway ? `You were removed from game ${props.gameId} while you were disconnected.` : `The host removed you from game ${props.gameId}.`}</p>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onBackHome}>
          Back To Home
        </button>
      </div>
    </Modal>
  );
}
