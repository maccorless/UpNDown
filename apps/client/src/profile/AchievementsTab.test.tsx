import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AchievementsTab } from './AchievementsTab.js';
import { dataFor, row } from './profile-fixtures.js';

const show = (rows = [row()], seen: Record<string, number> = {}, signedIn = false) => render(<AchievementsTab badges={dataFor(rows, signedIn).badges} seen={seen} tz="UTC" />);

describe('the achievements tab', () => {
  it('sums up how many badges are earned and how many are gold', () => {
    show();
    expect(screen.getByRole('status').textContent).toMatch(/^\d+ of 34 earned, 0 gold$/);
  });

  it('names the tier in words and shows progress toward the next, with the date it was earned', () => {
    show(Array.from({ length: 10 }, () => row()));
    const card = screen.getByText('Regular').closest('li')!;
    expect(card.textContent).toMatch(/Bronze/);
    expect(card.textContent).toMatch(/Bronze .*2026/);
    expect(card.querySelector('progress')?.getAttribute('aria-label')).toBe('Regular progress');
    expect(card.textContent).toMatch(/10 \/ 50/);
  });

  it('shows a locked badge with the goal for its first tier', () => {
    show([row({ outcome: 'lost', cardsLeft: 9 })]);
    const card = screen.getByText('Up and Away').closest('li')!;
    expect(card.textContent).toMatch(/Locked/);
    expect(card.textContent).toMatch(/0 \/ 1/);
  });

  it('hides a locked secret behind ??? with only a hint, and reveals it once earned', () => {
    show([row()]);
    expect(screen.getAllByText('???').length).toBeGreaterThan(0);
    expect(screen.queryByText('Perfect Ten')).toBeNull();
    const { unmount } = render(<div />);
    unmount();
    show([row({ specialPlays: 10 })]);
    expect(screen.getAllByText('Perfect Ten').length).toBeGreaterThan(0);
  });

  it('shows a one-time badge as Earned, with no metal, and does not count it as gold', () => {
    show([row()]);
    const card = screen.getByText('First Steps').closest('li')!;
    expect(card.textContent).toMatch(/Earned/);
    expect(card.textContent).not.toMatch(/Bronze|Silver|Gold/);
  });

  it('lists the badges closest to their next tier first under "Almost there"', () => {
    show(Array.from({ length: 9 }, () => row()));
    const almost = screen.getByRole('heading', { name: 'Almost there' }).parentElement!;
    expect(almost.textContent).toMatch(/Regular/);
    expect(almost.querySelectorAll('li').length).toBeLessThanOrEqual(3);
  });

  it('never shows a badge lower than the tier the player was already shown', () => {
    show([], { regular: 2 });
    const card = screen.getByText('Regular').closest('li')!;
    expect(card.textContent).toMatch(/Silver/);
  });

  it('filters to what is earned and what is in progress', () => {
    show([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Earned' }));
    expect(screen.queryByText('Full Table')).toBeNull();
    expect(screen.getByText('First Steps')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Earned' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'In progress' }));
    expect(screen.queryByText('First Steps')).toBeNull();
  });

  it('shows the speedrunner badge as a best time, because smaller is better there', () => {
    show([row({ mode: 'solitaire', playerCount: 1, durationMs: 590_000 })]);
    const card = screen.getByText('Speedrunner').closest('li')!;
    expect(card.textContent).toMatch(/Best: 9m 50s/);
  });

  it('earns Made It Official for a signed-in account without any game', () => {
    show([], {}, true);
    expect(screen.getByText('Made It Official').closest('li')!.textContent).toMatch(/Earned/);
  });
});
