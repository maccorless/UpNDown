import { buildDeck, createStartedGameState, playCard, shuffle } from '@upndown/engine';
import { normalSolitaireSettings, solitaireResultPayloadSchema, type GameState } from '@upndown/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSolitairePayload, newRunId, postSolitaireResult } from './solitaire-result.js';

const fresh = (): GameState => createStartedGameState({
  gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
  settings: normalSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(normalSolitaireSettings))
});

// One card from winning, reached through the real engine: the last card is played, not declared.
function winningGame(): GameState {
  const state = structuredClone(fresh());
  state.drawPile = [];
  state.players[0]!.hand = [{ id: 'c-2', value: 2 }];
  state.statistics.startedAtMs = Date.now() - 600_000;
  state.statistics.players['solo-player'] = { cardsPlayed: 97, totalMovement: 400, specialPlays: 3, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0, lifelines: 0, markFollows: 0 };
  return playCard(state, 'solo-player', 'c-2', 0);
}

function lostGame(): GameState {
  const state = structuredClone(fresh());
  state.statistics.startedAtMs = Date.now() - 300_000;
  state.statistics.endedAtMs = Date.now();
  state.statistics.players['solo-player'] = { cardsPlayed: 40, totalMovement: 150, specialPlays: 1, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0, lifelines: 0, markFollows: 0 };
  state.drawPile = state.drawPile.slice(0, 40);
  state.players[0]!.hand = state.players[0]!.hand.slice(0, 18);
  return { ...state, gamePhase: 'lost' };
}

describe('the result a finished solitaire game reports', () => {
  it('describes a win from the real engine, with the totals the player earned', () => {
    const won = winningGame();
    expect(won.gamePhase).toBe('won');
    const payload = buildSolitairePayload(won, 'run-1')!;
    expect(payload).toMatchObject({
      gameId: 'run-1', outcome: 'won', cardsTotal: 98, cardsLeft: 0, cardsPlayed: 98, specialPlays: 3, nasCheats: 0,
      startedAtMs: won.statistics.startedAtMs, endedAtMs: won.statistics.endedAtMs
    });
    expect(payload.totalMovement).toBe(401);
    expect(payload.settings).toEqual(won.settings);
  });

  it('describes a loss by the cards that were left', () => {
    const lost = lostGame();
    const left = lost.drawPile.length + lost.players[0]!.hand.length;
    expect(left).toBeGreaterThan(0);
    const payload = buildSolitairePayload(lost, 'run-2')!;
    expect(payload).toMatchObject({ outcome: 'lost', cardsPlayed: 40, cardsLeft: left, cardsTotal: 98 });
  });

  // The client and the server must agree on what a valid result is. If the schema changes on one side only, this fails.
  it('always satisfies the same schema the server checks', () => {
    for (const state of [winningGame(), lostGame()]) {
      const payload = buildSolitairePayload(state, 'run-3');
      expect(solitaireResultPayloadSchema.safeParse(payload).success).toBe(true);
    }
  });

  // A tab left open with a game running for weeks must still be savable: the server stores at most 24 days.
  it('reports at most 24 days of play, however long the tab was left open', () => {
    const won = winningGame();
    const ended = Date.now();
    const stale = { ...won, statistics: { ...won.statistics, startedAtMs: ended - 40 * 24 * 3_600_000, endedAtMs: ended } };
    const payload = buildSolitairePayload(stale, 'run-long')!;
    expect(payload.endedAtMs - payload.startedAtMs).toBe(24 * 24 * 3_600_000);
    expect(solitaireResultPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('leaves an ordinary game\'s times exactly as they were', () => {
    const won = winningGame();
    const payload = buildSolitairePayload(won, 'run-short')!;
    expect(payload.startedAtMs).toBe(won.statistics.startedAtMs);
    expect(payload.endedAtMs).toBe(won.statistics.endedAtMs);
  });

  it('is nothing while the game is still being played, so ending a game early reports nothing', () => {
    expect(buildSolitairePayload(fresh(), 'run-4')).toBeNull();
    expect(buildSolitairePayload({ ...winningGame(), gamePhase: 'lobby' }, 'run-4')).toBeNull();
  });

  it('is nothing when the numbers could not be a real game, rather than something the server will refuse', () => {
    const impossible = { ...winningGame(), drawPile: [{ id: 'c-50', value: 50 }] };
    expect(buildSolitairePayload(impossible, 'run-5')).toBeNull();
  });
});

describe('what the result says about help and undo', () => {
  it('reports each kind of cheat used and the undos, so a signed-in game and the same game kept on a device agree (Clean Hands depends on it)', () => {
    const won = winningGame();
    won.statistics.players['solo-player'] = { ...won.statistics.players['solo-player']!, skipsUsed: 1, tradesUsed: 2, lookupsUsed: 3, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 4, undosUsed: 5 };
    expect(buildSolitairePayload(won, 'run-9')).toMatchObject({ skips: 1, trades: 2, lookups: 3, hints: 4, undos: 5, playedLastCard: true });
  });

  it('says the winning card was not the player\'s for a loss', () => {
    expect(buildSolitairePayload(lostGame(), 'run-10')).toMatchObject({ playedLastCard: false });
  });
});

describe('sending it', () => {
  afterEach(() => vi.unstubAllGlobals());
  const payload = () => buildSolitairePayload(winningGame(), 'run-6')!;

  it('posts the result as JSON with the session cookie, and says whether it was accepted', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await postSolitaireResult(payload())).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/solitaire-results');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init.body as string).gameId).toBe('run-6');
  });

  // A failure that may pass is kept and retried; one the server refused for good is dropped, so it cannot loop forever.
  it.each([[400, 'permanent'], [409, 'permanent'], [413, 'permanent'], [401, 'retry'], [429, 'retry'], [500, 'retry'], [503, 'retry']])('answers %i with %s', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    expect(await postSolitaireResult(payload())).toBe(expected);
  });

  it('is a retry, not a crash, with no connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await postSolitaireResult(payload())).toBe('retry');
  });
});

describe('newRunId', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is unique and in the form the server accepts', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))).toBe(true);
  });

  it('still works where the browser has no randomUUID', () => {
    vi.stubGlobal('crypto', {});
    expect(newRunId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
