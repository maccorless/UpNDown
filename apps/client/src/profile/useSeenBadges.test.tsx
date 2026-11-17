import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { authOf } from './profile-fixtures.js';
import { useSeenBadges } from './useSeenBadges.js';

describe('the badges a player has been shown', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('keeps a guest\'s on the device and remembers the highest tier', () => {
    const history = createLocalHistory();
    const { result } = renderHook(() => useSeenBadges(authOf({ status: 'guest' }), history));
    act(() => result.current.markSeen({ regular: 2 }));
    act(() => result.current.markSeen({ regular: 1 }));
    expect(result.current.seen).toEqual({ regular: 2 });
    expect(history.seen()).toEqual({ regular: 2 });
  });

  it('takes a signed-in player\'s from the account, and never writes them to the device (signing out must not hand the account\'s badges to the guest profile)', () => {
    const history = createLocalHistory();
    const auth = authOf({ status: 'signedIn', settings: { seenBadges: { duet: 1 } } });
    const { result } = renderHook(() => useSeenBadges(auth, history));
    expect(result.current.seen).toEqual({ duet: 1 });
    act(() => result.current.markSeen({ regular: 1 }));
    expect(result.current.seen).toEqual({ duet: 1, regular: 1 });
    expect(history.seen()).toEqual({});
  });

  it('goes back to the device\'s record when the player signs out', () => {
    const history = createLocalHistory();
    history.setSeen({ solo: 1 });
    const { result, rerender } = renderHook(({ auth }) => useSeenBadges(auth, history), { initialProps: { auth: authOf({ status: 'signedIn', settings: { seenBadges: { duet: 3 } } }) } });
    expect(result.current.seen).toEqual({ duet: 3 });
    rerender({ auth: authOf({ status: 'guest' }) });
    expect(result.current.seen).toEqual({ solo: 1 });
  });
});
