import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadgeToasts } from './BadgeToasts.js';

const toasts = [{ id: 'a', title: 'First Steps', body: 'Finish your first game.' }, { id: 'b', title: 'Duet, Bronze', body: 'Win a two-player game.', extra: 'Sign in to keep this.' }];

describe('the toast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sits in a polite live region (without taking the page\'s one status role) and shows one toast at a time', () => {
    const { container } = render(<BadgeToasts toasts={toasts} onDismiss={() => undefined} onOpen={() => undefined} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('First Steps')).toBeTruthy();
    expect(screen.queryByText('Duet, Bronze')).toBeNull();
  });

  it('floats for eight seconds, long enough to read while it drifts up, then goes by itself', () => {
    const onDismiss = vi.fn();
    render(<BadgeToasts toasts={toasts} onDismiss={onDismiss} onOpen={() => undefined} />);
    act(() => { vi.advanceTimersByTime(7_999); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_001); });
    expect(onDismiss).toHaveBeenCalledWith('a');
  });

  it('goes away and opens the Achievements tab when tapped, so the player can see what they earned', () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    render(<BadgeToasts toasts={toasts} onDismiss={onDismiss} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onDismiss).toHaveBeenCalledWith('a');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the sign-in line when there is one', () => {
    render(<BadgeToasts toasts={[toasts[1]!]} onDismiss={() => undefined} onOpen={() => undefined} />);
    expect(screen.getByText('Sign in to keep this.')).toBeTruthy();
  });

  it('renders an empty live region when there is nothing to say (so a screen reader has it before the first toast)', () => {
    const { container } = render(<BadgeToasts toasts={[]} onDismiss={() => undefined} onOpen={() => undefined} />);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
  });
});
