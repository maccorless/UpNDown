import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { ProfilePage, type ProfileTab } from './ProfilePage.js';
import { authOf, dataFor, row, sourceOf, viewOf } from './profile-fixtures.js';

const setup = (over: Partial<Parameters<typeof ProfilePage>[0]> = {}) => {
  const props = {
    auth: authOf(), view: viewOf(), history: createLocalHistory(), authEnabled: true, seen: {}, tab: 'stats' as ProfileTab,
    onTab: vi.fn(), onBack: vi.fn(), onSignIn: vi.fn(), onPlay: vi.fn(), ...over
  };
  render(<ProfilePage {...props} />);
  return props;
};

describe('the profile page for a guest', () => {
  it('says plainly that the profile lives only in this browser, what will be lost, and that signing in keeps it', () => {
    const props = setup();
    expect(screen.getByText('Your profile lives only in this browser.')).toBeTruthy();
    expect(screen.getByText(/Your stats, profile and achievements will be lost if you clear your browser data, switch browser or device, or reset this device\. Sign in with Google to keep them\. Everything you have so far comes with you\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(props.onSignIn).toHaveBeenCalled();
  });

  it('cannot be dismissed, and is absent for a signed-in player', () => {
    setup({ auth: authOf({ status: 'signedIn', playerName: 'Ann Lee' }) });
    expect(screen.queryByText('Your profile lives only in this browser.')).toBeNull();
    expect(screen.getByText('Ann Lee, signed in with Google')).toBeTruthy();
  });

  it('is only a neutral note, with no sign-in button, where sign-in is not available', () => {
    setup({ authEnabled: false });
    expect(screen.getByText('Stats are saved on this device.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
  });

  it('does not promise that history will come along when the browser cannot keep it (sign-in discards memory)', () => {
    setup({ view: viewOf({ storageStatus: 'memory' }) });
    expect(screen.getByText('Your browser is blocking storage, so your stats last only until you close this tab.')).toBeTruthy();
    expect(screen.getByText(/Signing in will not bring this history along/)).toBeTruthy();
    expect(screen.queryByText(/Everything you have so far comes with you/)).toBeNull();
  });

  it('reports a full device apart from a blocked one, and an unreadable history', () => {
    const { unmount } = render(<div />);
    unmount();
    setup({ view: viewOf({ storageStatus: 'full' }) });
    expect(screen.getByText('This device is out of storage, so new games cannot be saved here.')).toBeTruthy();
  });

  it('tells the player when the history on the device could not be read and a fresh one was started', () => {
    setup({ view: viewOf({ storageStatus: 'corrupt-reset' }) });
    expect(screen.getByRole('status').textContent).toMatch(/could not be read/);
  });

  it('warns as the device nears its limit', () => {
    setup({ view: viewOf({ data: { ...dataFor([]), stats: { ...dataFor([]).stats, totals: { ...dataFor([]).stats.totals, games: 4_600 } } } }) });
    expect(screen.getByText(/4,600 of 5,000 games of history/)).toBeTruthy();
  });
});

describe('the tabs', () => {
  it('lists Statistics and Achievements as tabs, one selected, and moves between them with the arrow keys', () => {
    const props = setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Statistics', 'Achievements, 1 new'].slice(0, 1).concat(tabs[1]!.textContent ?? ''));
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(props.onTab).toHaveBeenCalledWith('achievements');
  });

  it('counts badges the player has not been shown yet in the Achievements tab name', () => {
    const rows = [row()];
    setup({ view: viewOf({ data: dataFor(rows) }), seen: {} });
    expect(screen.getByRole('tab', { name: /Achievements, \d+ new/ })).toBeTruthy();
  });

  it('shows no count once everything earned has been shown', () => {
    const rows = [row()];
    const data = dataFor(rows);
    const seen = Object.fromEntries(data.badges.filter((b) => b.tier > 0).map((b) => [b.id, b.tier]));
    setup({ view: viewOf({ data }), seen });
    expect(screen.getByRole('tab', { name: 'Achievements' })).toBeTruthy();
  });

  it('shows the achievements panel, with a retry if they could not load', () => {
    const reload = vi.fn();
    setup({ tab: 'achievements', view: viewOf({ state: 'error', reload }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalled();
  });
});

describe('erasing the history on this device', () => {
  it('asks first, names how many games, and only then deletes', () => {
    const history = createLocalHistory();
    window.localStorage.clear();
    history.add(row());
    const view = viewOf({ data: dataFor([row(), row()]), source: sourceOf() });
    setup({ history, view });
    fireEvent.click(screen.getByRole('button', { name: 'Erase history on this device' }));
    expect(screen.getByText(/deletes 2 games and your badges/)).toBeTruthy();
    expect(history.load().rows).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    expect(history.load().rows).toHaveLength(0);
  });

  it('is not offered to a signed-in player, whose history is in the account', () => {
    setup({ auth: authOf({ status: 'signedIn' }) });
    expect(screen.queryByRole('button', { name: 'Erase history on this device' })).toBeNull();
  });
});

describe('changing your name from the profile', () => {
  const signedIn = authOf({ status: 'signedIn', playerName: 'Ann Lee' });

  it('offers Change name to a signed-in player, and asks for the name dialog when it is pressed', () => {
    const onChangeName = vi.fn();
    setup({ auth: signedIn, onChangeName });
    fireEvent.click(screen.getByRole('button', { name: 'Change name' }));
    expect(onChangeName).toHaveBeenCalledTimes(1);
  });

  it('does not offer it where the name cannot be asked for (in a game), or to a guest, whose name is the one typed in the lobby', () => {
    setup({ auth: signedIn });
    expect(screen.queryByRole('button', { name: 'Change name' })).toBeNull();
  });

  it('does not offer it to a guest even when the page could ask', () => {
    setup({ onChangeName: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Change name' })).toBeNull();
  });
});
