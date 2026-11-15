import type { ReconnectionView } from '@upndown/shared-types';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionNotices, hasConnectionNotices } from './ConnectionNotices.js';

const players = [{ id: 'host', name: 'Hana' }, { id: 'p2', name: 'Ann' }, { id: 'p3', name: 'Bo' }, { id: 'me', name: 'Me' }];
const view = (over: Partial<ReconnectionView> = {}): ReconnectionView => ({ lost: [], canKick: [], canTakeOver: null, ...over });
const reconnecting = (playerId: string, name: string) => ({ playerId, name, status: 'reconnecting' as const });
const lostFor90 = (playerId: string, name: string) => ({ playerId, name, status: 'lost' as const });

function setup(reconnection: ReconnectionView | undefined, viewerId = 'me') {
  const onKick = vi.fn();
  const onTakeOver = vi.fn();
  const utils = render(<ConnectionNotices reconnection={reconnection} viewerId={viewerId} players={players} onKick={onKick} onTakeOver={onTakeOver} />);
  const rerender = (next: ReconnectionView | undefined) =>
    utils.rerender(<ConnectionNotices reconnection={next} viewerId={viewerId} players={players} onKick={onKick} onTakeOver={onTakeOver} />);
  return { ...utils, onKick, onTakeOver, rerender };
}
const region = () => document.querySelector('.connection-notices') as HTMLElement;

describe('ConnectionNotices: when nothing is wrong', () => {
  // A game in which everyone is connected must look exactly as it did. The live region is there, empty.
  it.each([['no information', undefined], ['an empty list', view()]])('shows nothing for %s, only an empty live region', (_why, reconnection) => {
    setup(reconnection);
    expect(region().textContent).toBe('');
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows nothing about the viewer\'s own dropped connection, which has its own banner', () => {
    setup(view({ lost: [reconnecting('me', 'Me')], canKick: ['me'], canTakeOver: 'me' }));
    expect(region().textContent).toBe('');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('ConnectionNotices: everyone is told', () => {
  it('says who has lost their connection and that it is trying to reconnect, exactly with their name', () => {
    setup(view({ lost: [reconnecting('p2', 'Ann')] }));
    expect(within(region()).getByText('Ann has lost their connection. Trying to reconnect...')).toBeTruthy();
  });

  it('says it for a player who has been gone long enough to be removed too, and offers a viewer without rights nothing', () => {
    setup(view({ lost: [lostFor90('p2', 'Ann')] }));
    expect(within(region()).getByText('Ann has lost their connection. Trying to reconnect...')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says it for each player who is gone, and leaves out the viewer', () => {
    setup(view({ lost: [reconnecting('p2', 'Ann'), reconnecting('me', 'Me'), reconnecting('p3', 'Bo')] }));
    const lines = within(region()).getAllByText(/has lost their connection/).map((el) => el.textContent);
    expect(lines).toEqual([
      'Ann has lost their connection. Trying to reconnect...',
      'Bo has lost their connection. Trying to reconnect...'
    ]);
  });

  it('shows a name exactly as given, whatever it contains', () => {
    setup(view({ lost: [reconnecting('p2', 'Zoë O\'Neil-1')] }));
    expect(screen.getByText('Zoë O\'Neil-1 has lost their connection. Trying to reconnect...')).toBeTruthy();
  });
});

describe('ConnectionNotices: the host may kick, or keep waiting', () => {
  it('offers the kick only for a player the server says may be kicked, not for one who has only just dropped', () => {
    setup(view({ lost: [lostFor90('p2', 'Ann'), reconnecting('p3', 'Bo')], canKick: ['p2'] }));
    expect(screen.getByText('Ann has not come back.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kick Ann' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kick Bo' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Keep waiting' })).toHaveLength(1);
  });

  it('asks before removing, says what happens to their cards and that it is a quit, and sends nothing on Cancel', async () => {
    const { onKick, onTakeOver } = setup(view({ lost: [lostFor90('p2', 'Ann')], canKick: ['p2'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Kick Ann' }));
    expect(screen.getByRole('heading', { name: 'Remove Ann?' })).toBeTruthy();
    expect(screen.getByText('Their cards go back into the draw pile and the game goes on without them. It counts as a quit for them.')).toBeTruthy();
    expect(onKick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onKick).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Remove Ann?' })).toBeNull();
    expect(onTakeOver).not.toHaveBeenCalled();
  });

  it('sends exactly one kick for that player when confirmed, and nothing else', async () => {
    const { onKick, onTakeOver } = setup(view({ lost: [lostFor90('p2', 'Ann'), lostFor90('p3', 'Bo')], canKick: ['p2', 'p3'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Kick Bo' }));
    expect(screen.getByRole('heading', { name: 'Remove Bo?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bo' }));
    expect(onKick).toHaveBeenCalledTimes(1);
    expect(onKick).toHaveBeenCalledWith('p3');
    expect(onTakeOver).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /Remove/ })).toBeNull();
  });

  it('starts the dialog on the safe choice', async () => {
    setup(view({ lost: [lostFor90('p2', 'Ann')], canKick: ['p2'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Kick Ann' }));
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('data-autofocus')).toBe(true);
  });
});

describe('ConnectionNotices: taking over from a host who is gone', () => {
  const hostGone = (): ReconnectionView => view({ lost: [lostFor90('host', 'Hana')], canTakeOver: 'host' });

  it('offers the next available player to take over, with the host named, and no kick buttons', () => {
    setup(hostGone());
    expect(screen.getByText('Hana, the host, has not come back.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take over as host' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Kick/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Keep waiting' })).toHaveLength(1);
  });

  it('offers nothing to a player the server did not choose', () => {
    setup(view({ lost: [lostFor90('host', 'Hana')], canTakeOver: null }));
    expect(screen.queryByRole('button', { name: 'Take over as host' })).toBeNull();
    expect(screen.getByText('Hana has lost their connection. Trying to reconnect...')).toBeTruthy();
  });

  it('never offers anyone the chance to take over from themselves', () => {
    setup(view({ lost: [lostFor90('host', 'Hana')], canTakeOver: 'host' }), 'host');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('explains the removal and the quit, and sends nothing on Cancel', async () => {
    const { onKick, onTakeOver } = setup(hostGone());
    await userEvent.click(screen.getByRole('button', { name: 'Take over as host' }));
    expect(screen.getByRole('heading', { name: 'Take over as host?' })).toBeTruthy();
    expect(screen.getByText('Hana will be removed from the game, and it counts as a quit for them. You will then control kicking and ending the game.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('data-autofocus')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onTakeOver).not.toHaveBeenCalled();
    expect(onKick).not.toHaveBeenCalled();
  });

  it('sends exactly one take-over naming the host when confirmed', async () => {
    const { onKick, onTakeOver } = setup(hostGone());
    await userEvent.click(screen.getByRole('button', { name: 'Take over as host' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(onTakeOver).toHaveBeenCalledTimes(1);
    expect(onTakeOver).toHaveBeenCalledWith('host');
    expect(onKick).not.toHaveBeenCalled();
  });
});

describe('ConnectionNotices: keep waiting', () => {
  it('hides that player\'s prompt but not the notice, and the prompt returns only after it has gone away', async () => {
    const gone = view({ lost: [lostFor90('p2', 'Ann')], canKick: ['p2'] });
    const { rerender } = setup(gone);
    await userEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('button', { name: 'Kick Ann' })).toBeNull();
    expect(screen.getByText('Ann has lost their connection. Trying to reconnect...')).toBeTruthy();

    rerender(gone); // the same prompt arriving again is still "keep waiting"
    expect(screen.queryByRole('button', { name: 'Kick Ann' })).toBeNull();

    rerender(view()); // Ann came back
    rerender(gone); // and dropped again: a new decision
    expect(screen.getByRole('button', { name: 'Kick Ann' })).toBeTruthy();
  });

  it('applies to one player at a time', async () => {
    setup(view({ lost: [lostFor90('p2', 'Ann'), lostFor90('p3', 'Bo')], canKick: ['p2', 'p3'] }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Keep waiting' })[0]!);
    expect(screen.queryByRole('button', { name: 'Kick Ann' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kick Bo' })).toBeTruthy();
  });

  it('hides the take-over prompt the same way', async () => {
    setup(view({ lost: [lostFor90('host', 'Hana')], canTakeOver: 'host' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('button', { name: 'Take over as host' })).toBeNull();
  });
});

describe('ConnectionNotices: names', () => {
  it('uses the player list when the server names a prompt for someone not in the lost list, and a plain word when nobody knows them', () => {
    setup(view({ canKick: ['p3', 'ghost'] }));
    expect(screen.getByText('Bo has not come back.')).toBeTruthy();
    expect(screen.getByText('A player has not come back.')).toBeTruthy();
  });
});

describe('hasConnectionNotices', () => {
  it('is false when nothing needs saying, including when the only drop is the viewer\'s own', () => {
    expect(hasConnectionNotices(undefined, 'me')).toBe(false);
    expect(hasConnectionNotices(view(), 'me')).toBe(false);
    expect(hasConnectionNotices(view({ lost: [reconnecting('me', 'Me')] }), 'me')).toBe(false);
  });

  it('is true when someone else has dropped, or a prompt is due', () => {
    expect(hasConnectionNotices(view({ lost: [reconnecting('p2', 'Ann')] }), 'me')).toBe(true);
    expect(hasConnectionNotices(view({ canKick: ['p2'] }), 'me')).toBe(true);
    expect(hasConnectionNotices(view({ canTakeOver: 'host' }), 'me')).toBe(true);
  });
});
