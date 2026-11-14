import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignInCard } from './SignInCard.js';
import type { AuthState } from './useAuth.js';

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'guest',
  playerName: null,
  loginMessage: null,
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  dismissLoginMessage: vi.fn(),
  ...overrides
});

describe('SignInCard', () => {
  // Disabled auth must leave today's landing screen untouched, and loading must not flash buttons at a signed-in player.
  it.each(['loading', 'disabled', 'signedIn'] as const)('renders nothing when status is %s', (status) => {
    const { container } = render(<SignInCard auth={makeAuth({ status })} />);
    expect(container.innerHTML).toBe('');
  });

  it('offers Google sign-in and a quiet guest line, with no separate guest button', () => {
    render(<SignInCard auth={makeAuth()} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(screen.getByText('No account needed: play as a guest below.')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['cancelled', 'Sign-in cancelled. You can try again, or play as a guest below.'],
    ['failed', 'Sign-in did not work. Try again, or play as a guest below.']
  ] as const)('announces the %s message with role=alert', (loginMessage, text) => {
    render(<SignInCard auth={makeAuth({ loginMessage })} />);
    expect(screen.getByRole('alert').textContent).toBe(text);
  });

  it('starts sign-in and drops an old error when the button is pressed', () => {
    const auth = makeAuth({ loginMessage: 'failed' });
    render(<SignInCard auth={auth} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(auth.dismissLoginMessage).toHaveBeenCalledTimes(1);
  });
});
