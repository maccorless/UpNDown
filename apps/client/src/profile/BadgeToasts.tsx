import { useEffect } from 'react';

export interface Toast { id: string; title: string; body: string; extra?: string }

const SHOW_MS = 5_000;

// One at a time, after the result screen, never during a game. Each stays at least four seconds and can be dismissed. Everything
// said here is also on the Achievements tab, so a missed toast loses nothing.
export function BadgeToasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }): JSX.Element {
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
        <button type="button" className="badge-toast" onClick={() => onDismiss(current.id)}>
          <strong>{current.title}</strong>
          <p>{current.body}</p>
          {current.extra ? <p>{current.extra}</p> : null}
        </button>
      ) : null}
    </div>
  );
}
