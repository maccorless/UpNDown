import { useState } from 'react';
import { Modal } from './Modal.js';

interface InviteModalProps {
  link: string;
  expiresAtMs: number;
  onClose: () => void;
}

// The host's invitation to a game already being played: a single-use link. Whoever opens it asks to join, and the host
// still has to say yes.
export function InviteModal({ link, expiresAtMs, onClose }: InviteModalProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const minutes = Math.max(1, Math.round((expiresAtMs - Date.now()) / 60_000));
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal className="panel invite-modal" dismiss="any" label="invite someone to this game" onClose={onClose}>
      <h2>Invite someone</h2>
      <p>Send this link to one person. It works once, for about {minutes} minutes, and you will be asked before they join.</p>
      <input readOnly value={link} aria-label="Invitation link" data-testid="invite-late-link" onFocus={(e) => e.currentTarget.select()} />
      <div className="button-row">
        <button type="button" className="primary" data-autofocus data-testid="copy-late-invite" onClick={() => { void copy(); }}>{copied ? 'Copied' : 'Copy link'}</button>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

interface JoinRequestModalProps {
  playerName: string;
  busy: boolean;
  onAnswer: (approve: boolean) => void;
}

// Asked of the host, who must answer: nobody is dealt in without it. Declining is the safe action and where focus starts.
export function JoinRequestModal({ playerName, busy, onAnswer }: JoinRequestModalProps): JSX.Element {
  return (
    <Modal className="panel end-game-confirm-modal" dismiss="none" label="someone wants to join" onClose={() => undefined}>
      <h2>{playerName} wants to join</h2>
      <p>Let them in? They are dealt a hand from the draw pile. Nobody else's cards, and no pile, change.</p>
      <div className="button-row">
        <button type="button" className="secondary" data-autofocus disabled={busy} data-testid="decline-join" onClick={() => onAnswer(false)}>Decline</button>
        <button type="button" className="primary" disabled={busy} data-testid="accept-join" onClick={() => onAnswer(true)}>Let in</button>
      </div>
    </Modal>
  );
}
