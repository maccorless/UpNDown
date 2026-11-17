import { cleanPlayerName, shortPlayerName } from '@upndown/shared-types';
import { useEffect, useId, useRef } from 'react';
import type { AuthState } from './useAuth.js';

// Newer HTML attributes are missing from React 18's types; spread them as an untyped bag.
const invoker = (menuId: string): object => ({ commandfor: menuId, command: 'toggle-popover' });
const nativeFocusgroup = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
const anchorPositioning = typeof CSS !== 'undefined' && CSS.supports('position-area', 'block-end');

// `locked` is true while seated in a game: signing out would drop the player from it. The item stays
// focusable (aria-disabled, not disabled) so the reason is reachable by keyboard and touch.
export function ProfileMenu({ auth, locked, currentName, onOpenProfile }: { auth: AuthState; locked: boolean; currentName?: string; onOpenProfile?: () => void }): JSX.Element | null {
  const menuId = useId();
  const hintId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedByPointer = useRef(false);
  const signedIn = auth.status === 'signedIn';
  const ready = auth.status !== 'loading';
  // The name being typed in the landing field shows at once; an empty field falls back to the saved name.
  const label = cleanPlayerName(currentName ?? '') || auth.playerName;

  // React 18 has no typed onToggle for a div, so listen natively. The menu only exists while signed in.
  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return undefined;
    const onToggle = (event: Event): void => {
      const open = (event as ToggleEvent).newState === 'open';
      trigger.setAttribute('aria-expanded', String(open));
      if (open && !openedByPointer.current) itemRef.current?.focus(); // keyboard opens enter the menu
      openedByPointer.current = false;
      if (open && !anchorPositioning) {
        // Without CSS anchor positioning a popover would sit centred on screen: place it under the trigger, inside the viewport.
        const t = trigger.getBoundingClientRect();
        const width = menu.offsetWidth;
        menu.style.left = `${Math.max(8, Math.min(t.right - width, window.innerWidth - width - 8))}px`;
        menu.style.top = `${t.bottom + 4}px`;
      }
    };
    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, [ready]);

  // Nothing until sign-in is known, so the menu never flashes the wrong state. A guest gets a menu too: their profile lives on the device.
  if (!ready) return null;

  return (
    <div className="profile-menu" data-locked={locked && signedIn ? 'true' : undefined}>
      <button
        ref={triggerRef}
        id={`${menuId}-trigger`}
        type="button"
        className="secondary profile-trigger"
        aria-haspopup="menu"
        aria-expanded="false"
        onPointerDown={() => { openedByPointer.current = true; }}
        {...invoker(menuId)}
      >
        {/* Under 480px only the glyph shows, so the header fits; the name stays as the button's accessible name. */}
        <svg className="profile-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" />
        </svg>
        <span className="profile-name">{signedIn ? (label ? shortPlayerName(label) : 'Signed in') : 'Profile'}</span>
        {!signedIn ? <span className="profile-chip">This device only</span> : null}
      </button>
      <div ref={menuRef} id={menuId} className="profile-menu-list" {...({ popover: 'auto' } as object)}>
        {/* Nested, not on the popover: Chromium drops focusgroup keyboard behaviour otherwise. One item, so no arrow-key fallback. */}
        <div {...({ focusgroup: 'menu nomemory' } as object)} role={nativeFocusgroup ? undefined : 'menu'} aria-labelledby={`${menuId}-trigger`}>
          <button
            ref={itemRef}
            type="button"
            role={nativeFocusgroup ? undefined : 'menuitem'}
            onClick={() => {
              menuRef.current?.hidePopover?.();
              onOpenProfile?.();
            }}
          >
            Profile
          </button>
          {signedIn ? (
            <button
              type="button"
              role={nativeFocusgroup ? undefined : 'menuitem'}
              aria-disabled={locked ? 'true' : undefined}
              aria-describedby={locked ? hintId : undefined}
              onClick={() => {
                if (locked) return;
                menuRef.current?.hidePopover?.();
                void auth.signOut();
              }}
            >
              Sign out
            </button>
          ) : auth.status === 'guest' ? (
            <button
              type="button"
              role={nativeFocusgroup ? undefined : 'menuitem'}
              onClick={() => {
                menuRef.current?.hidePopover?.();
                auth.signIn();
              }}
            >
              Sign in with Google
            </button>
          ) : null}
        </div>
        {locked && signedIn ? <p id={hintId} className="profile-menu-hint">Leave the game to sign out.</p> : null}
      </div>
    </div>
  );
}
