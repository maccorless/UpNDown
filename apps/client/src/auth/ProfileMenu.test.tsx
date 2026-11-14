import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu.js';
import { useAuth, type AuthState } from './useAuth.js';

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'signedIn',
  playerName: 'Ken',
  settings: null,
  loginMessage: null,
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  nameConfirmed: true,
  confirmName: async (name: string) => name,
  dismissLoginMessage: vi.fn(),
  ...overrides
});

describe('ProfileMenu', () => {
  it.each(['loading', 'disabled', 'guest'] as const)('renders nothing when status is %s', (status) => {
    const { container } = render(<ProfileMenu auth={makeAuth({ status })} locked={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('labels the menu button with the player name, or "Signed in" when the account has none', () => {
    const { unmount } = render(<ProfileMenu auth={makeAuth()} locked={false} />);
    expect(screen.getByRole('button', { name: 'Ken' }).getAttribute('aria-haspopup')).toBe('menu');
    unmount();
    render(<ProfileMenu auth={makeAuth({ playerName: null })} locked={false} />);
    expect(screen.getByRole('button', { name: 'Signed in' })).toBeTruthy();
  });

  // Editing the name on the landing page must show in the header straight away, not after a reload.
  it('shows the name being edited in short form, and falls back to the saved name when the field is empty', () => {
    const { rerender } = render(<ProfileMenu auth={makeAuth({ playerName: 'Warren Harrison' })} locked={false} currentName="Warren Harrison" />);
    expect(screen.getByRole('button', { name: 'Warren H' })).toBeTruthy();
    rerender(<ProfileMenu auth={makeAuth({ playerName: 'Warren Harrison' })} locked={false} currentName="Zed Zee" />);
    expect(screen.getByRole('button', { name: 'Zed Zee' })).toBeTruthy();
    rerender(<ProfileMenu auth={makeAuth({ playerName: 'Warren Harrison' })} locked={false} currentName="   " />);
    expect(screen.getByRole('button', { name: 'Warren H' })).toBeTruthy();
    rerender(<ProfileMenu auth={makeAuth({ playerName: 'Warren Harrison' })} locked={false} currentName={'\u202E'} />);
    expect(screen.getByRole('button', { name: 'Warren H' })).toBeTruthy();
  });

  it('wires the button to its popover with an invoker, not popovertarget', () => {
    render(<ProfileMenu auth={makeAuth()} locked={false} />);
    const trigger = screen.getByRole('button', { name: 'Ken' });
    const menu = document.getElementById(trigger.getAttribute('commandfor') ?? '');
    expect(trigger.getAttribute('command')).toBe('toggle-popover');
    expect(trigger.hasAttribute('popovertarget')).toBe(false);
    expect(menu?.getAttribute('popover')).toBe('auto');
  });

  it('signs out from the menu when unlocked', () => {
    const auth = makeAuth();
    render(<ProfileMenu auth={auth} locked={false} />);
    const item = screen.getByRole('menuitem', { name: 'Sign out' });
    expect(item.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText('Leave the game to sign out.')).toBeNull();
    fireEvent.click(item);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  // Signing out mid-game would drop the player from their seat. The item stays focusable so the reason is reachable.
  it('keeps Sign out focusable but inert while locked, and explains why', () => {
    const auth = makeAuth();
    render(<ProfileMenu auth={auth} locked />);
    const item = screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.disabled).toBe(false);
    const hint = screen.getByText('Leave the game to sign out.');
    expect(item.getAttribute('aria-describedby')).toBe(hint.id);
    fireEvent.click(item);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  describe('against the real hook', () => {
    afterEach(() => vi.unstubAllGlobals());
    const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
    function Harness({ locked }: { locked: boolean }): JSX.Element {
      return <ProfileMenu auth={useAuth()} locked={locked} />;
    }
    const stub = () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/auth/config') return json({ enabled: true, providers: ['google'] });
        if (url === '/api/me') return json({ playerName: 'Ken' });
        return json({ ok: true });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };
    const logouts = (fetchMock: ReturnType<typeof stub>) => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout');

    it('Sign out calls the logout API once and the menu goes away', async () => {
      const fetchMock = stub();
      render(<Harness locked={false} />);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Ken' })).toBeNull());
      expect(logouts(fetchMock)).toHaveLength(1);
    });

    it('does not call the logout API while locked', async () => {
      const fetchMock = stub();
      render(<Harness locked />);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
      expect(logouts(fetchMock)).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Ken' })).toBeTruthy();
    });
  });

  // The header is tight on phones, so a "First Last" mash-up shows as "First L". The button keeps that as its name.
  it('shows a generated two-part name shortened, and any other name as it is', () => {
    const { rerender } = render(<ProfileMenu auth={makeAuth({ playerName: 'Donald Washington' })} locked={false} />);
    expect(screen.getByRole('button', { name: 'Donald W' })).toBeTruthy();
    rerender(<ProfileMenu auth={makeAuth({ playerName: 'Sam Typed' })} locked={false} />);
    expect(screen.getByRole('button', { name: 'Sam Typed' })).toBeTruthy();
  });
});
