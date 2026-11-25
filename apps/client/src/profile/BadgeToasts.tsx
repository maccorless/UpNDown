import { useEffect } from 'react';

export interface Toast { id: string; title: string; body: string; extra?: string }

// Matches the float in App.css. Long enough to read while it drifts up the screen.
const SHOW_MS = 8_000;

// One at a time, after the result screen, never during a game. Each floats up the screen for eight seconds, then goes by itself.
// A tap takes the player to the Achievements tab. Everything said here is also on that tab, so a missed toast loses nothing.
export function BadgeToasts({ toasts, onDismiss, onOpen }: { toasts: Toast[]; onDismiss: (id: string) => void; onOpen: () => void }): JSX.Element {
  const current = toasts[0];
  useEffect(() => {
    if (!current) return undefined;
    const timer = setTimeout(() => onDismiss(current.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current, onDismiss]);

  // A live region, but not role="status": the app already has one status element for game announcements, and tests and
  // assistive tech find that one by its role.
  return (
    <div className="badge-toasts" aria-live="polite" aria-atomic="true">
      {current ? (
        <button type="button" className="badge-toast" onClick={() => { onDismiss(current.id); onOpen(); }}>
          <strong>{current.title}</strong>
          <p>{current.body}</p>
          {current.extra ? <p>{current.extra}</p> : null}
          <p className="badge-toast-hint">See your achievements</p>
        </button>
      ) : null}
    </div>
  );
}
