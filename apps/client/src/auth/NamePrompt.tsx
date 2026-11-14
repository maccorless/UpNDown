import { cleanPlayerName, randomPresidentName, shortPlayerName } from '@upndown/shared-types';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../Modal.js';
import type { AuthState } from './useAuth.js';

interface NamePromptProps {
  auth: AuthState;
  // True while the player is in a game, where a prompt would be an interruption.
  suppress: boolean;
  // True when the player asked to change their name (from the landing screen), after the first time.
  editing: boolean;
  onClose: () => void;
  onConfirmed: (name: string) => void;
}

// Asked once, on first sign-in: the server has handed out a random name, but it is not theirs until they say so.
export function NamePrompt({ auth, suppress, editing, onClose, onConfirmed }: NamePromptProps): JSX.Element | null {
  const first = auth.status === 'signedIn' && !auth.nameConfirmed;
  if (suppress || auth.status !== 'signedIn' || !(first || editing)) return null;
  return <NameDialog key={first ? 'first' : 'edit'} auth={auth} first={first} onClose={onClose} onConfirmed={onConfirmed} />;
}

function NameDialog({ auth, first, onClose, onConfirmed }: Pick<NamePromptProps, 'auth' | 'onClose' | 'onConfirmed'> & { first: boolean }): JSX.Element {
  const [name, setName] = useState(() => auth.playerName ?? randomPresidentName());
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const previewId = useId();
  const cleaned = cleanPlayerName(name);

  // Selected, so typing replaces the suggestion and pressing Enter accepts it.
  useEffect(() => { inputRef.current?.select(); }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!cleaned || saving) return;
    setSaving(true);
    setFailed(false);
    const saved = await auth.confirmName(cleaned);
    setSaving(false);
    if (saved === null) {
      setFailed(true);
      return;
    }
    onConfirmed(saved);
    onClose();
  };

  return (
    // The first time there is no way out but choosing: Esc must not leave an unchosen name behind.
    <Modal className="name-prompt" dismiss={first ? 'none' : 'esc'} onClose={onClose} labelledBy={titleId}>
      <form className="name-form" onSubmit={(event) => { void submit(event); }}>
        <h2 id={titleId}>Your player name</h2>
        <p className="name-lead">Input your player name or accept a random one.</p>
        <label htmlFor={inputId}>Player name</label>
        <div className="name-field">
          <input
            ref={inputRef}
            id={inputId}
            name="playerName"
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={32}
            value={name}
            onChange={(event) => { setName(event.target.value); setFailed(false); }}
            aria-describedby={previewId}
            data-autofocus
          />
          <button type="button" className="name-shuffle" aria-label="Pick another random name" title="Pick another random name" onClick={() => setName(randomPresidentName())}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
              <circle cx="15.5" cy="8.5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" />
              <circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
            </svg>
          </button>
        </div>
        {/* Not a live region: it would announce on every keystroke. It is read as the field's description. */}
        <p id={previewId} className="name-preview">Other players will see: <strong>{cleaned ? shortPlayerName(cleaned) : 'nothing yet'}</strong></p>
        {failed ? <p className="name-error" role="alert">Could not save your name. Try again.</p> : null}
        <div className="name-actions">
          {first ? null : <button type="button" className="secondary" onClick={onClose}>Cancel</button>}
          <button type="submit" className="primary" disabled={!cleaned || saving}>Continue</button>
        </div>
      </form>
    </Modal>
  );
}
