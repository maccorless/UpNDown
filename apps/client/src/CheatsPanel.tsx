import { useState } from 'react';
import { CHEAT_TITLES, type CheatStatus } from './cheats.js';
import { Modal } from './Modal.js';

interface CheatsPanelProps {
  statuses: CheatStatus[];
  onClose: () => void;
  onLookup: () => void;
  onSkip: () => void;
  onTrade: () => void;
  // Open straight on the skip confirmation (the keyboard shortcut).
  startWithSkipConfirm?: boolean;
  // True while a request is in flight, so a double click cannot use a cheat twice.
  busy: boolean;
}

const HELP: Record<'lookup' | 'skip' | 'trade', string> = {
  lookup: 'Find out where a card is. Only you see the answer.',
  skip: 'Pass your turn without playing the minimum. Use it before you are stuck.',
  trade: 'Swap the selected card for the next card from the draw pile.'
};

// The cheats a game allows, each a button. One already used up under a "once" limit is grayed out and says so in words, not
// only in color. Opened by double tapping the logo, the Cheats menu entry, or the keyboard.
export function CheatsPanel({ statuses, onClose, onLookup, onSkip, onTrade, busy, startWithSkipConfirm = false }: CheatsPanelProps): JSX.Element {
  const [confirmingSkip, setConfirmingSkip] = useState(startWithSkipConfirm);
  const act = (kind: CheatStatus['kind']): void => {
    if (kind === 'skip') setConfirmingSkip(true);
    else if (kind === 'trade') { onTrade(); onClose(); }
    else if (kind === 'lookup') { onLookup(); onClose(); }
  };

  if (confirmingSkip) {
    return (
      <Modal className="panel end-game-confirm-modal" dismiss="esc" label="skip your turn" onClose={() => setConfirmingSkip(false)}>
        <h2>Skip your turn?</h2>
        <p>You pass without playing the minimum. Other players are told. This cannot be undone.</p>
        <div className="button-row">
          <button type="button" className="secondary" data-autofocus onClick={() => setConfirmingSkip(false)}>Keep playing</button>
          <button type="button" className="danger" data-testid="confirm-skip" disabled={busy} onClick={() => { onSkip(); setConfirmingSkip(false); onClose(); }}>Skip my turn</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal className="panel cheats-panel" dismiss="any" label="cheats" onClose={onClose}>
      <h2>Cheats</h2>
      {statuses.length === 0 ? <p>This game has no cheats turned on.</p> : (
        <ul className="cheats-list">
          {statuses.map((status) => {
            const kind = status.kind as 'lookup' | 'skip' | 'trade';
            return (
              <li key={status.kind} className="cheats-item">
                <button
                  type="button"
                  className="secondary"
                  data-testid={`cheat-${status.kind}`}
                  aria-disabled={!status.available || busy}
                  disabled={!status.available || busy}
                  onClick={() => act(status.kind)}
                >
                  {CHEAT_TITLES[status.kind]}
                </button>
                <span className="cheats-note">
                  {status.reason ?? HELP[kind]}
                  {status.limit === 'once' && !status.reason ? ' One use per game.' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="button-row">
        <button type="button" className="secondary" data-autofocus onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
