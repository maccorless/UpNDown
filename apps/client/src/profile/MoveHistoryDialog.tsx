import { evaluateAchievements } from '@upndown/profile';
import { useEffect, useState } from 'react';
import type { AuthState } from '../auth/useAuth.js';
import { Modal } from '../Modal.js';
import { formatDay } from './format.js';
import type { LocalHistory } from './local-history.js';
import { moveHistory, type MoveResult } from './moveHistory.js';
import type { ProfileSource } from './source.js';
import { deviceTimeZone } from './useProfile.js';

interface Props {
  auth: AuthState;
  history: LocalHistory;
  source: ProfileSource | null;
  // The badges the account now has are marked as shown, so moving a history does not announce every one of them.
  markSeen: (map: Record<string, number>) => void;
}

type Phase = 'closed' | 'ask' | 'moving' | 'done' | 'problem';

// Offered, never done on its own: the browser may be shared, and the games on it may not be the signed-in person's.
export function MoveHistoryDialog({ auth, history, source, markSeen }: Props): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('closed');
  const [result, setResult] = useState<MoveResult | null>(null);
  const [offered, setOffered] = useState(false);
  const tz = deviceTimeZone();
  const signedIn = auth.status === 'signedIn';

  // Once per page load, when the account becomes known and the device holds games.
  useEffect(() => {
    if (!signedIn || offered) return;
    setOffered(true);
    if (history.load().rows.length > 0) setPhase('ask');
  }, [signedIn, offered, history]);

  if (phase === 'closed' || !signedIn) return null;
  const rows = history.load().rows;
  const earned = evaluateAchievements(rows, { tz, now: Date.now(), signedIn: false }).filter((b) => b.tier > 0).length;
  const first = rows.reduce((m, r) => Math.min(m, r.endedAtMs), Infinity);
  const last = rows.reduce((m, r) => Math.max(m, r.endedAtMs), 0);

  const run = async (): Promise<void> => {
    setPhase('moving');
    const outcome = await moveHistory(history);
    setResult(outcome);
    if (outcome.remaining === 0) {
      history.setMovedAtMs(Date.now());
      // What the guest had been shown now belongs to the account, and the device no longer holds the games behind it.
      markSeen(history.seen());
      history.resetSeen();
      try {
        const data = await source?.load(tz);
        if (data) markSeen(Object.fromEntries(data.badges.filter((b) => b.tier > 0).map((b) => [b.id, b.tier])));
      } catch { /* the badges will simply be announced as they are earned */ }
    }
    setPhase(outcome.error === 'none' || outcome.error === 'rejected' ? 'done' : 'problem');
  };

  const close = (): void => setPhase('closed');

  return (
    <Modal className="confirm-dialog move-history" dismiss={phase === 'moving' ? 'none' : 'esc'} onClose={close} label="Add this device's games to your account">
      {phase === 'ask' ? (
        <>
          <h3>Add the {rows.length} {rows.length === 1 ? 'game' : 'games'} from this device to your account?</h3>
          <p>These games were played on this device as a guest, between {formatDay(first, tz)} and {formatDay(last, tz)}. They earned {earned} {earned === 1 ? 'badge' : 'badges'}. Adding them keeps them with your account on every device.</p>
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={close}>Not now</button>
            <button type="button" data-autofocus onClick={() => { void run(); }}>Add to my account</button>
          </div>
        </>
      ) : null}
      {phase === 'moving' ? <p role="status">Adding your games...</p> : null}
      {phase === 'done' && result ? (
        <>
          <h3>Added {result.moved} {result.moved === 1 ? 'game' : 'games'} to your account.</h3>
          {result.refused > 0 ? (
            <p role="status">{result.refused} {result.refused === 1 ? 'game could not be added, and stays' : 'games could not be added, and stay'} on this device.</p>
          ) : null}
          <div className="confirm-actions">
            {result.refused > 0 ? <button type="button" className="secondary" onClick={() => { history.discardRejected(); close(); }}>Discard them</button> : null}
            <button type="button" data-autofocus onClick={close}>Done</button>
          </div>
        </>
      ) : null}
      {phase === 'problem' && result ? (
        <>
          <h3>{result.error === 'full' ? 'Your account is full.' : 'Your games are not all added yet.'}</h3>
          <p role="status">
            {result.error === 'offline' ? 'Your history is safe on this device. We could not reach the server.'
              : result.error === 'full' ? 'Your account holds 10,000 games, the most it can. The rest stay on this device.'
              : 'Something went wrong. Your history is safe on this device.'}
            {' '}{result.remaining} {result.remaining === 1 ? 'game is' : 'games are'} still waiting.
          </p>
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={close}>Close</button>
            {result.error !== 'full' ? <button type="button" data-autofocus onClick={() => { void run(); }}>Retry</button> : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
