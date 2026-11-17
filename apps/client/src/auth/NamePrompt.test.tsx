import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PRESIDENT_FIRST_NAMES } from '@upndown/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NamePrompt } from './NamePrompt.js';
import type { AuthState } from './useAuth.js';

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'signedIn',
  storage: 'ok',
  userId: null,
  playerName: 'Grover Arthur',
  nameConfirmed: false,
  settings: null,
  loginMessage: null,
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  confirmName: vi.fn(async (name: string) => name),
  dismissLoginMessage: vi.fn(),
  ...overrides
});

const setup = (auth: AuthState, props: Partial<{ suppress: boolean; editing: boolean }> = {}) => {
  const onClose = vi.fn();
  const onConfirmed = vi.fn();
  const view = render(<NamePrompt auth={auth} suppress={false} editing={false} onClose={onClose} onConfirmed={onConfirmed} {...props} />);
  return { onClose, onConfirmed, ...view };
};
const field = () => screen.getByLabelText('Player name') as HTMLInputElement;

describe('NamePrompt: when it appears', () => {
  // The prompt asks about a name the player has not chosen. Asking anyone else is noise, and asking a guest has no account to save to.
  it.each([
    ['a guest', { status: 'guest' as const }],
    ['a page still loading', { status: 'loading' as const }],
    ['auth switched off', { status: 'disabled' as const }],
    ['a player who already chose', { nameConfirmed: true }]
  ])('stays away for %s', (_why, overrides) => {
    const { container } = setup(makeAuth(overrides));
    expect(container.innerHTML).toBe('');
  });

  it('stays away while the player is in a game, even if the name is unchosen', () => {
    const { container } = setup(makeAuth(), { suppress: true });
    expect(container.innerHTML).toBe('');
  });

  it('appears on first sign-in with the owner\'s wording and the suggested name selected', () => {
    setup(makeAuth());
    expect(screen.getByRole('heading', { name: 'Your player name' })).toBeTruthy();
    expect(screen.getByText('Input your player name or accept a random one.')).toBeTruthy();
    expect(field().value).toBe('Grover Arthur');
    expect(field().getAttribute('autocomplete')).toBe('nickname');
  });

  it('can be opened again on request by a player who already chose, and then offers Cancel', async () => {
    const { onClose } = setup(makeAuth({ nameConfirmed: true }), { editing: true });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('NamePrompt: choosing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts the suggestion with one press', async () => {
    const auth = makeAuth();
    const { onConfirmed } = setup(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('Grover Arthur'));
    expect(auth.confirmName).toHaveBeenCalledWith('Grover Arthur');
  });

  it('saves a typed name cleaned of control and bidirectional characters, on Enter', async () => {
    const auth = makeAuth();
    const { onConfirmed } = setup(auth);
    await userEvent.clear(field());
    await userEvent.type(field(), '  Pat{Enter}');
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('Pat'));
    fireEvent.change(field(), { target: { value: 'A‮b' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(auth.confirmName).toHaveBeenLastCalledWith('Ab'));
  });

  it('cannot save an empty name', async () => {
    const auth = makeAuth();
    setup(auth);
    await userEvent.clear(field());
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field(), { target: { value: '‮   ' } });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(auth.confirmName).not.toHaveBeenCalled();
  });

  it('shuffle picks another president name', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    setup(makeAuth());
    await userEvent.click(screen.getByRole('button', { name: 'Pick another random name' }));
    expect(field().value).toBe('George Washington');
    expect(PRESIDENT_FIRST_NAMES).toContain(field().value.split(' ')[0]);
  });

  // The preview is what everyone else in a game will read, so it must be the real short form.
  it('previews how other players will see the name, and describes the field with it', async () => {
    setup(makeAuth());
    expect(screen.getByText('Other players will see:').textContent).toContain('Grover A');
    const previewId = field().getAttribute('aria-describedby') as string;
    expect(document.getElementById(previewId)?.textContent).toBe('Other players will see: Grover A');
    await userEvent.clear(field());
    await userEvent.type(field(), 'Mary Ann');
    expect(document.getElementById(previewId)?.textContent).toBe('Other players will see: Mary Ann');
    expect(document.getElementById(previewId)?.getAttribute('aria-live')).toBeNull();
  });

  it('stays open with an alert when saving fails, so the player can try again', async () => {
    const auth = makeAuth({ confirmName: vi.fn(async () => null) });
    const { onConfirmed, onClose } = setup(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save your name. Try again.');
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(field(), 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('NamePrompt: leaving', () => {
  // Esc on the first prompt must not leave an unchosen name behind and a landing page that never asked again.
  it('cannot be dismissed with Esc the first time, but can when the player asked to change their name', () => {
    const first = setup(makeAuth());
    const firstCancel = new Event('cancel', { cancelable: true });
    document.querySelector('dialog')!.dispatchEvent(firstCancel);
    expect(firstCancel.defaultPrevented).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    first.unmount();

    setup(makeAuth({ nameConfirmed: true }), { editing: true });
    const editCancel = new Event('cancel', { cancelable: true });
    document.querySelector('dialog')!.dispatchEvent(editCancel);
    expect(editCancel.defaultPrevented).toBe(false);
  });
});
