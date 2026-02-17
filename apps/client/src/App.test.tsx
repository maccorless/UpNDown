import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

describe('solitaire App', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders foundation piles and hand', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-solitaire'));

    expect(screen.getByRole('heading', { name: 'Foundation Piles' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your Hand' })).toBeTruthy();

    const cards = screen.getAllByTestId(/hand-card-/);
    expect(cards.length).toBe(7);
  });

  it('plays a selected card to a valid pile and updates top value', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-solitaire'));

    const firstCard = screen.getAllByTestId(/hand-card-/)[0];
    if (!firstCard) throw new Error('missing first card');
    const chosenValue = firstCard.textContent;

    await user.click(firstCard);
    await user.click(screen.getByTestId('pile-0'));

    expect(screen.getByTestId('pile-top-0').textContent).toBe(chosenValue ?? '');
  });

  it('shows an error when trying an invalid move', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-solitaire'));

    // Force an invalid move path with deterministic deck order:
    // play a high card to ascending pile, then attempt a much lower non-backward-10 card.
    const cards = screen.getAllByTestId(/hand-card-/);
    const values = cards
      .map((el) => ({
        el,
        value: Number(el.textContent)
      }))
      .sort((a, b) => b.value - a.value);

    const high = values[0];
    const lowInvalid = values.find((entry) => {
      if (!high) return false;
      return entry.value < high.value && entry.value !== high.value - 10;
    });

    if (!high || !lowInvalid) throw new Error('test setup failed');

    await user.click(high.el);
    await user.click(screen.getByTestId('pile-0'));

    await user.click(lowInvalid.el);
    await user.click(screen.getByTestId('pile-0'));

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
