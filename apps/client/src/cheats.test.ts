import { buildDeck, createStartedGameState } from '@upndown/engine';
import { defaultMultiplayerSettings, type CheatLimit, type GameState } from '@upndown/shared-types';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cheatNoticeText, cheatStatuses, keepCheatCounts, useCheatHotkeys } from './cheats.js';

const game = (limits: Partial<Record<'lookup' | 'skip' | 'trade' | 'hint', CheatLimit>>, over: Partial<GameState> = {}): GameState => ({
  ...createStartedGameState({
    gameId: 'ABC123', hostId: 'p1',
    players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }],
    settings: { ...defaultMultiplayerSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', ...limits } },
    isSolitaire: false, deck: buildDeck(defaultMultiplayerSettings)
  }),
  ...over
});
const find = (state: GameState, player: string, kind: string, selected: string | null = 'c-5') =>
  cheatStatuses(state, player, selected).find((s) => s.kind === kind);

describe('which cheats a player is offered', () => {
  it('lists only the cheats the game has turned on', () => {
    expect(cheatStatuses(game({}), 'p1', null)).toEqual([]);
    expect(cheatStatuses(game({ lookup: 'once', trade: 'unlimited' }), 'p1', 'c-5').map((s) => s.kind)).toEqual(['lookup', 'trade']);
  });

  it('grays out a "once" cheat after its use, and says why, but never an unlimited one', () => {
    const base = game({ lookup: 'once', trade: 'unlimited' });
    const used: GameState = { ...base, statistics: { ...base.statistics, players: { ...base.statistics.players, p1: { ...base.statistics.players.p1!, lookupsUsed: 1, tradesUsed: 5 } } } };
    expect(find(used, 'p1', 'lookup')).toMatchObject({ available: false, reason: 'Already used', used: 1 });
    expect(find(used, 'p1', 'trade')).toMatchObject({ available: true, used: 5 });
  });

  it('allows skip only on your own turn and before a card is played', () => {
    const state = game({ skip: 'once' });
    expect(find(state, 'p1', 'skip')?.available).toBe(true);
    expect(find(state, 'p2', 'skip')).toMatchObject({ available: false, reason: 'Only on your turn' });
    expect(find({ ...state, cardsPlayedThisTurn: 1 }, 'p1', 'skip')?.available).toBe(false);
  });

  it('never offers skip in solitaire, where there is no turn to skip', () => {
    expect(cheatStatuses(game({ skip: 'unlimited' }, { isSolitaire: true }), 'p1', null)).toEqual([]);
  });

  it('needs a selected card and a card in the draw pile to trade', () => {
    const state = game({ trade: 'once' });
    expect(find(state, 'p1', 'trade', null)).toMatchObject({ available: false, reason: 'Select a card in your hand first' });
    expect(find({ ...state, drawPile: [] }, 'p1', 'trade')).toMatchObject({ available: false, reason: 'The draw pile is empty' });
  });

  it('offers nothing when the game is over', () => {
    expect(find(game({ trade: 'unlimited' }, { gamePhase: 'won' }), 'p1', 'trade')?.available).toBe(false);
  });
});

describe('what the others are told', () => {
  it('names who and what, and nothing more', () => {
    expect(cheatNoticeText({ playerName: 'Ann', kind: 'skip' })).toBe('Ann skipped a turn');
    expect(cheatNoticeText({ playerName: 'Ann', kind: 'trade' })).toBe('Ann traded a card');
    expect(cheatNoticeText({ playerName: 'Ann', kind: 'lookup' })).toBe('Ann used the card seeker');
    expect(cheatNoticeText({ playerName: '', kind: 'lookup' })).toBe('A player used the card seeker');
  });
});

describe('undo and cheats', () => {
  it('keeps cheats counted since the snapshot, so undoing a play never refunds one', () => {
    const snapshot = game({ lookup: 'once' });
    const now: GameState = { ...snapshot, statistics: { ...snapshot.statistics, players: { ...snapshot.statistics.players, p1: { ...snapshot.statistics.players.p1!, lookupsUsed: 1 } } } };
    expect(keepCheatCounts(snapshot, now).statistics.players.p1!.lookupsUsed).toBe(1);
    expect(keepCheatCounts(snapshot, now).drawPile).toBe(snapshot.drawPile);
  });
});

describe('cheat hotkeys', () => {
  function Harness(props: { active: boolean; onLookup?: () => void; onSkip?: () => void; onTrade?: () => void }): null {
    useCheatHotkeys(props);
    return null;
  }
  const press = async (keys: string): Promise<boolean> => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    const watch = (e: KeyboardEvent): void => { seen.push(e.defaultPrevented); };
    window.addEventListener('keydown', watch);
    await user.keyboard(keys);
    window.removeEventListener('keydown', watch);
    return seen.some(Boolean);
  };

  it('takes Ctrl-P, Ctrl-S and Ctrl-Shift-X only for a cheat that is available, so printing and saving still work otherwise', async () => {
    const onLookup = vi.fn();
    const onSkip = vi.fn();
    render(createElement(Harness, { active: true, onLookup }));
    expect(await press('{Control>}p{/Control}')).toBe(true);
    expect(onLookup).toHaveBeenCalledTimes(1);
    expect(await press('{Control>}s{/Control}')).toBe(false); // skip not available here: the browser keeps it
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('works with Cmd on a Mac, and with Shift for trade', async () => {
    const onSkip = vi.fn();
    const onTrade = vi.fn();
    render(createElement(Harness, { active: true, onSkip, onTrade }));
    await press('{Meta>}s{/Meta}');
    await press('{Control>}{Shift>}x{/Shift}{/Control}');
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it('does nothing while typing in a field (the card seeker input), or when no cheat is on', async () => {
    const onLookup = vi.fn();
    const view = render(createElement('div', null, createElement(Harness, { active: true, onLookup }), createElement('input', { 'aria-label': 'field' })));
    const user = userEvent.setup();
    await user.click(view.getByLabelText('field'));
    await user.keyboard('{Control>}p{/Control}');
    expect(onLookup).not.toHaveBeenCalled();
    view.unmount();
    render(createElement(Harness, { active: false, onLookup }));
    await user.keyboard('{Control>}p{/Control}');
    expect(onLookup).not.toHaveBeenCalled();
  });
});
