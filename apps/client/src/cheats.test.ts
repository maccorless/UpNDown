import { buildDeck, createStartedGameState, isValidPlay } from '@upndown/engine';
import { readFileSync } from 'node:fs';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type CheatLimit, type GameState } from '@upndown/shared-types';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cheatNoticeText, cheatStatuses, describeHint, keepCheatCounts, moveKey, soloHint, useCheatHotkeys } from './cheats.js';

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
    const used: GameState = { ...base, statistics: { ...base.statistics, players: { ...base.statistics.players, p1: { ...base.statistics.players.p1!, lookupsUsed: 1, nasChecksUsed: 0, montyUsed: 0, tradesUsed: 5 } } } };
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
    const now: GameState = { ...snapshot, statistics: { ...snapshot.statistics, players: { ...snapshot.statistics.players, p1: { ...snapshot.statistics.players.p1!, lookupsUsed: 1, nasChecksUsed: 0, montyUsed: 0 } } } };
    expect(keepCheatCounts(snapshot, now, 'p1').statistics.players.p1!.lookupsUsed).toBe(1);
    expect(keepCheatCounts(snapshot, now, 'p1').drawPile).toBe(snapshot.drawPile);
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

describe('hints', () => {
  it('lists hint among the cheats, only on your own turn', () => {
    const state = game({ hint: 'once' });
    expect(find(state, 'p1', 'hint')?.available).toBe(true);
    expect(find(state, 'p2', 'hint')).toMatchObject({ available: false, reason: 'Only on your turn' });
  });

  it('says a play in words and lights up the card and the pile', () => {
    const state = game({ hint: 'once' });
    const mine = state.players[0]!.hand[0]!;
    const view = describeHint({ type: 'play', cardId: mine.id, pileId: 0 }, state, 'p1');
    expect(view).toMatchObject({ cardId: mine.id, pileId: 0 });
    expect(view.text).toBe(`Hint: play ${mine.value} on the up pile showing ${state.foundationPiles[0]!.topCard.value}.`);
    expect(describeHint({ type: 'play', cardId: mine.id, pileId: 2 }, state, 'p1').text).toContain('down pile');
  });

  it('says the other advice in words, and has nothing to light up for it', () => {
    const state = game({ hint: 'once' });
    expect(describeHint({ type: 'endTurn' }, state, 'p1')).toEqual({ text: 'Hint: you have played enough. End your turn.' });
    expect(describeHint({ type: 'skip' }, state, 'p1').text).toContain('Skip it');
    expect(describeHint({ type: 'none' }, state, 'p1').text).toBe('Hint: no play is possible.');
    const dead = state.players[0]!.hand[0]!;
    expect(describeHint({ type: 'trade', cardId: dead.id }, state, 'p1')).toMatchObject({ cardId: dead.id });
  });

  it('keeps the same key while only a count changes, and a new one when the game moves', () => {
    const state = game({ hint: 'unlimited' });
    const counted: GameState = { ...state, statistics: { ...state.statistics, players: { ...state.statistics.players, p1: { ...state.statistics.players.p1!, hintsUsed: 3 } } } };
    expect(moveKey(counted, 'p1')).toBe(moveKey(state, 'p1'));
    expect(moveKey({ ...state, cardsPlayedThisTurn: 1 }, 'p1')).not.toBe(moveKey(state, 'p1'));
    expect(moveKey(null, 'p1')).toBe('');
  });
});

// Hints that give reasons, and the solitaire hint that works in the browser.
describe('hints with reasons', () => {
  it('puts the reasons after the hint, only when there are some', () => {
    const state = game({ hint: 'once' });
    const mine = state.players[0]!.hand.find((c) => state.foundationPiles.some((p) => isValidPlay(c, p)))!;
    const pile = state.foundationPiles.find((p) => isValidPlay(mine, p))!;
    const action = { type: 'play' as const, cardId: mine.id, pileId: pile.id };
    expect(describeHint(action, state, 'p1').text).not.toContain('Why');
    expect(describeHint(action, state, 'p1', []).text).not.toContain('Why');
    expect(describeHint(action, state, 'p1', ['The smallest move you have (3 steps).', 'Your 47 can still follow on that pile.']).text)
      .toMatch(/^Hint: play \d+ on the (up|down) pile showing \d+\. Why: The smallest move you have \(3 steps\)\. Your 47 can still follow on that pile\.$/);
  });

  const solo = (): GameState => createStartedGameState({
    gameId: 'SOLO01', hostId: 'solo', players: [{ id: 'solo', name: 'Me' }],
    settings: { ...defaultSolitaireSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'unlimited' } }, isSolitaire: true, deck: buildDeck(defaultSolitaireSettings)
  });

  it('gives a legal move with reasons when the network file can be fetched', async () => {
    // the file the browser fetches: public/models/hint.json is a link to the engine's screen-only network
    const weights = readFileSync('public/models/hint.json', 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(weights, { status: 200 })));
    const state = solo();
    const view = await soloHint(state, 'solo');
    expect(view.cardId).toBeDefined();
    expect(state.players[0]!.hand.some((c) => c.id === view.cardId)).toBe(true);
    expect(view.text).toMatch(/Why: /);
    vi.unstubAllGlobals();
  });

  it('falls back to the written strategy, without reasons, when the file cannot be fetched (offline)', async () => {
    vi.resetModules(); // forget a network loaded by the test above
    const { soloHint: fresh } = await import('./cheats.js');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const view = await fresh(solo(), 'solo');
    expect(view.text).toMatch(/^Hint: play \d+ on the (up|down) pile showing \d+\.$/);
    vi.unstubAllGlobals();
  });
});
