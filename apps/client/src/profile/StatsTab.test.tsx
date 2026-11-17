import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatsTab } from './StatsTab.js';
import { dataFor, NOW, row, sourceOf, viewOf } from './profile-fixtures.js';

const noop = () => undefined;
const show = (view = viewOf(), badgesEarned = 0) => render(<StatsTab view={view} tz="UTC" badgesEarned={badgesEarned} onPlay={noop} onOpenAchievements={noop} />);

describe('the statistics tab', () => {
  it('shows a loading message before anything has arrived', () => {
    show(viewOf({ state: 'loading', data: null }));
    expect(screen.getByRole('status').textContent).toBe('Loading your stats...');
  });

  it('offers Retry when the numbers could not be loaded, and does not show guessed ones', () => {
    const reload = vi.fn();
    show(viewOf({ state: 'error', data: null, reload }));
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load your stats/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalled();
  });

  it('says there are no games yet, with a way to play, and shows no tiles (a new profile has nothing to count)', () => {
    const onPlay = vi.fn();
    render(<StatsTab view={viewOf()} tz="UTC" badgesEarned={0} onPlay={onPlay} onOpenAchievements={noop} />);
    expect(screen.getByText('No games yet. Play one and your stats will show up here.')).toBeTruthy();
    expect(screen.queryByText('Win rate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play a game' }));
    expect(onPlay).toHaveBeenCalled();
  });

  it('shows the tiles, totals and records for a player with games, and counts abandoned games apart from the win rate', () => {
    const rows = [row({ outcome: 'won' }), row({ outcome: 'lost', cardsLeft: 3 }), row({ outcome: 'abandoned', cardsLeft: 9 })];
    show(viewOf({ data: dataFor(rows), source: sourceOf(rows) }), 4);
    expect(screen.getAllByText('Win rate')[0]!.previousSibling?.textContent).toBe('50%');
    expect(screen.getAllByText('Games')[0]!.previousSibling?.textContent).toBe('3');
    expect(screen.getByText('Badges earned').previousSibling?.textContent).toBe('4');
    expect(screen.getByText('Won, lost, abandoned').nextSibling?.textContent).toBe('1, 1, 1');
  });

  it('opens the achievements from the badges tile', () => {
    const onOpen = vi.fn();
    const rows = [row()];
    render(<StatsTab view={viewOf({ data: dataFor(rows), source: sourceOf(rows) })} tz="UTC" badgesEarned={2} onPlay={noop} onOpenAchievements={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Badges earned/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('writes the recent results as letters with a text name for each, so colour is not the only signal', () => {
    const rows = [row({ endedAtMs: NOW - 3_000 }), row({ outcome: 'lost', cardsLeft: 2, endedAtMs: NOW - 2_000 }), row({ outcome: 'abandoned', cardsLeft: 5, endedAtMs: NOW - 1_000 })];
    show(viewOf({ data: dataFor(rows), source: sourceOf(rows) }));
    const trend = screen.getByRole('list', { name: 'Results, oldest first' });
    expect(within(trend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['WWon', 'LLost', 'AAbandoned']);
  });

  it('breaks results down in tables that can stack on a phone', () => {
    const rows = [row(), row({ mode: 'solitaire', playerCount: 1 })];
    const { container } = show(viewOf({ data: dataFor(rows), source: sourceOf(rows) }));
    expect(container.querySelectorAll('table.stack-on-phone').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Solitaire')).toBeTruthy();
  });

  it('says how many games are waiting to sync', () => {
    const rows = [row()];
    show(viewOf({ data: dataFor(rows, true, 2), source: sourceOf(rows) }));
    expect(screen.getByText('2 games are waiting to sync.')).toBeTruthy();
  });

  it('lists history, newest first as given, and loads more on request', async () => {
    const rows = [row()];
    const first = Array.from({ length: 2 }, () => row());
    const second = [row({ outcome: 'lost', cardsLeft: 4 })];
    const source = sourceOf(rows, [{ rows: first, next: 'c1' }, { rows: second, next: null }]);
    show(viewOf({ data: dataFor(rows), source }));
    await waitFor(() => expect(screen.getAllByRole('listitem').filter((li) => li.className === '' || li.querySelector('.history-when')).length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(document.querySelector('.history-outcome.lost')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
