import { useEffect, useState, type MutableRefObject } from 'react';

const JOINABLE_POLL_BASE_MS = import.meta.env.MODE === 'test' ? 120 : 5000;
const JOINABLE_POLL_MAX_MS = import.meta.env.MODE === 'test' ? 600 : 30000;

// Keeps the --app-height CSS variable at the real visible height (mobile browser bars change it).
export function useViewportHeight(): void {
  useEffect(() => {
    const applyViewportHeight = (): void => {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    };

    const onResize = (): void => {
      applyViewportHeight();
      window.setTimeout(applyViewportHeight, 80);
    };

    applyViewportHeight();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onVisibilityChange = (): void => {
      setVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  return visible;
}

// While `enabled`, asks for the joinable games every few seconds, backing off after failures. `failuresRef` is the count
// `refresh` keeps: it adds one on a failed call and clears it on a good one.
export function useJoinablePoller(
  enabled: boolean,
  refresh: (options: { background: boolean }) => Promise<boolean>,
  failuresRef: MutableRefObject<number>
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    failuresRef.current = 0;
    let timer = 0;
    let cancelled = false;

    const schedule = (delayMs: number): void => {
      timer = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return;
      }

      const ok = await refresh({ background: true });
      if (cancelled) {
        return;
      }

      const failureCount = ok ? 0 : failuresRef.current;
      const nextDelay = ok
        ? JOINABLE_POLL_BASE_MS
        : Math.min(JOINABLE_POLL_MAX_MS, JOINABLE_POLL_BASE_MS * (2 ** Math.min(3, failureCount - 1)));
      schedule(nextDelay);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);
}
