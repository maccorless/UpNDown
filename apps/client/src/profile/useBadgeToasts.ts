import { badgeChanges, CATALOG, type BadgeChange } from '@upndown/profile';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Toast } from './BadgeToasts.js';
import type { LocalHistory } from './local-history.js';
import type { ProfileSource } from './source.js';
import { deviceTimeZone } from './useProfile.js';

const TIER = ['', 'Bronze', 'Silver', 'Gold'];
const WEEK_MS = 7 * 24 * 3_600_000;
// More new tiers than this at once (a backfill, or the first game after an upgrade) are one summary, not a stack of toasts.
const MAX_INDIVIDUAL = 5;

interface Args {
  source: ProfileSource | null;
  // Changes when a game has finished and its result is where the profile can see it. Null while no game is finished.
  finishedKey: string | null;
  // Waits this long before looking (a server needs a moment to write a multiplayer result).
  delayMs?: number;
  seen: Record<string, number>;
  markSeen: (map: Record<string, number>) => void;
  // Only a guest, with sign-in available, is ever asked to sign in.
  nudge: boolean;
  history: LocalHistory;
  now?: () => number;
}

export function useBadgeToasts({ source, finishedKey, delayMs = 0, seen, markSeen, nudge, history, now = Date.now }: Args): { toasts: Toast[]; dismiss: (id: string) => void; lastGame: ReadonlyMap<string, BadgeChange> } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // What the latest finished game changed, by badge id. Replaced by each finished game, so the Achievements tab can show it.
  const [lastGame, setLastGame] = useState<ReadonlyMap<string, BadgeChange>>(() => new Map());
  const handled = useRef<string | null>(null);
  const latest = useRef({ seen, markSeen, nudge });
  latest.current = { seen, markSeen, nudge };

  useEffect(() => {
    if (!source || !finishedKey || handled.current === finishedKey) return undefined;
    handled.current = finishedKey;
    let cancelled = false;
    const timer = setTimeout(() => {
      source.load(deviceTimeZone()).then((data) => {
        if (cancelled) return;
        const { seen: shown, markSeen: mark, nudge: askToSignIn } = latest.current;
        const fresh: Toast[] = [];
        const reached: Record<string, number> = {};
        for (const b of data.badges) {
          if (b.tier === 0) continue;
          reached[b.id] = b.tier;
          const def = CATALOG.find((c) => c.id === b.id);
          if (!def) continue;
          for (let tier = (shown[b.id] ?? 0) + 1; tier <= b.tier; tier += 1) {
            fresh.push({ id: `${b.id}:${tier}`, title: def.targets.length > 1 ? `${def.name}, ${TIER[tier]}` : def.name, body: def.blurb });
          }
        }
        setLastGame(badgeChanges(data.badges, data.beforeLatest));
        if (fresh.length === 0) return;
        mark(reached);
        if (fresh.length > MAX_INDIVIDUAL) {
          setToasts((q) => [...q, { id: `summary:${finishedKey}`, title: `${fresh.length} new badges`, body: 'See them on the Achievements tab of your profile.' }]);
          return;
        }
        // The one moment a guest has something worth keeping: say so, but at most once a week on this device.
        const last = history.nudgedAtMs();
        if (askToSignIn && (last === null || now() - last > WEEK_MS)) {
          fresh[0] = { ...fresh[0]!, extra: 'Sign in to keep this.' };
          history.setNudgedAtMs(now());
        }
        setToasts((q) => [...q, ...fresh]);
      }, () => undefined);
    }, delayMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source, finishedKey, delayMs, history, now]);

  const dismiss = useCallback((id: string) => setToasts((q) => q.filter((t) => t.id !== id)), []);
  return { toasts, dismiss, lastGame };
}
