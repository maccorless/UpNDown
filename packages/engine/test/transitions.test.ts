import { describe, expect, it } from 'vitest';
import type { Card, GameSettings } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { EngineError } from '../src/errors.js';
import { isValidPlay } from '../src/rules.js';
import { createStartedGameState, endTurn, playCard, recordCheatUse, settleAfterRemoval, skipTurn, tradeCard } from '../src/transitions.js';

const settings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 30,
  handSize: 5,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: false,
  allowUndo: false,
  privateGame: false
};

function card(value: number): Card {
  return { id: `c-${value}`, value };
}

describe('createStartedGameState', () => {
  it('deals cards and creates a playing state', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: buildDeck(settings)
    });

    expect(state.gamePhase).toBe('playing');
    expect(state.players).toHaveLength(2);
    expect(state.players[0]?.hand).toHaveLength(5);
    expect(state.players[1]?.hand).toHaveLength(5);
    expect(state.drawPile.length).toBe(19);
  });

  it('rejects invalid multiplayer player counts', () => {
    expect(() =>
      createStartedGameState({
        gameId: 'ABC123',
        hostId: 'p1',
        players: [{ id: 'p1', name: 'Host' }],
        settings,
        isSolitaire: false,
        deck: buildDeck(settings)
      })
    ).toThrowError(EngineError);
  });

  it('rejects when hostId does not match exactly one player', () => {
    expect(() =>
      createStartedGameState({
        gameId: 'ABC123',
        hostId: 'missing',
        players: [
          { id: 'p1', name: 'Host' },
          { id: 'p2', name: 'Player 2' }
        ],
        settings,
        isSolitaire: false,
        deck: buildDeck(settings)
      })
    ).toThrowError(EngineError);
  });

  // Changed 15-Nov-2026: a short deal used to give some players fewer cards than others. The deck is checked at the start now.
  it('refuses a partial initial deal instead of giving players uneven hands', () => {
    expect(() => createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [card(2), card(3), card(4)]
    })).toThrow(EngineError);
  });

  it('rejects solitaire settings that violate solitaire invariants', () => {
    expect(() =>
      createStartedGameState({
        gameId: 'SOL123',
        hostId: 'p1',
        players: [{ id: 'p1', name: 'Solo' }],
        settings: { ...settings, minPlayers: 2, maxPlayers: 2, autoRefillHand: false },
        isSolitaire: true,
        deck: buildDeck(settings)
      })
    ).toThrowError(EngineError);
  });
});

describe('playCard', () => {
  it('plays a valid card and updates pile top', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(12), card(13), card(11), card(20), card(10),
        card(22), card(14), card(25), card(24), card(23),
        card(15), card(16), card(17)
      ]
    });

    const next = playCard(state, 'p1', 'c-12', 0);

    expect(next.foundationPiles[0]?.topCard.value).toBe(12);
    expect(next.players[0]?.hand.map((c) => c.id)).not.toContain('c-12');
    expect(next.cardsPlayedThisTurn).toBe(1);
  });

  // Players compare this number with the piles they can see, so it must equal how far the piles ended from where they started.
  it('counts total movement as net progress, so a backward 10 takes ten away', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(12), card(5), card(2), card(6), card(30),
        card(7), card(8), card(9), card(10), card(11)
      ]
    });

    let next = playCard(state, 'p1', 'c-12', 0); // ascending 1 -> 12: +11
    next = playCard(next, 'p1', 'c-2', 0); // 12 -> 2 is a backward 10: -10
    next = playCard(next, 'p1', 'c-30', 2); // descending 31 -> 30: +1

    const stats = next.statistics.players.p1;
    expect(stats?.specialPlays).toBe(1);
    expect(stats?.totalMovement).toBe(2);
    const startToEnd = next.foundationPiles.reduce((sum, pile) => sum + Math.abs(pile.topCard.value - (pile.type === 'ascending' ? 1 : 31)), 0);
    expect(stats?.totalMovement).toBe(startToEnd);
  });

  it('rejects plays from non-active player', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: buildDeck(settings)
    });

    expect(() => playCard(state, 'p2', state.players[1]!.hand[0]!.id, 0)).toThrowError(EngineError);
  });

  it('auto refills immediately when setting is on', () => {
    const autoSettings = { ...settings, autoRefillHand: true };
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings: autoSettings,
      isSolitaire: false,
      deck: buildDeck(autoSettings)
    });

    const preHandSize = state.players[0]!.hand.length;
    const next = playCard(state, 'p1', state.players[0]!.hand[0]!.id, 0);
    expect(next.players[0]!.hand.length).toBe(preHandSize);
  });
});

describe('endTurn', () => {
  it('enforces minimum card plays per turn', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(12), card(14), card(16), card(18), card(20),
        card(13), card(15), card(17), card(19), card(21),
        card(22), card(23)
      ]
    });

    expect(() => endTurn(state, 'p1')).toThrowError(EngineError);
  });

  it('allows ending turn after required cards are played', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(12), card(11), card(14), card(13), card(16),
        card(15), card(18), card(17), card(20), card(19),
        card(22), card(21), card(24)
      ]
    });

    const afterFirst = playCard(state, 'p1', 'c-12', 0);
    const afterSecond = playCard(afterFirst, 'p1', 'c-14', 1);
    const ended = endTurn(afterSecond, 'p1');

    expect(ended.currentPlayerIndex).toBe(1);
    expect(ended.cardsPlayedThisTurn).toBe(0);
  });

  it('forces minimum to 1 when draw pile is empty', () => {
    const tinySettings: GameSettings = {
      minCardValue: 2,
      maxCardValue: 11,
      handSize: 5,
      minPlayers: 2,
      maxPlayers: 6,
      minCardsPerTurn: 3,
      autoRefillHand: false,
      allowUndo: false,
      privateGame: false
    };

    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings: tinySettings,
      isSolitaire: false,
      deck: buildDeck(tinySettings)
    });

    const onePlay = playCard(state, 'p1', state.players[0]!.hand[0]!.id, 0);
    const ended = endTurn(onePlay, 'p1');

    expect(onePlay.drawPile).toHaveLength(0);
    expect(ended.currentPlayerIndex).toBe(1);
  });

  it('does not mark lost when active player has met min plays and can end turn', () => {
    const losingState = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(28), card(18), card(29), card(4), card(2),
        card(5), card(3), card(6), card(8), card(7),
        card(9), card(10), card(11), card(12), card(13), card(14)
      ]
    });

    const afterFirst = playCard(losingState, 'p1', 'c-28', 0);
    const afterSecond = playCard(afterFirst, 'p1', 'c-29', 1);
    const afterThird = playCard(afterSecond, 'p1', 'c-2', 2);
    const afterFourth = playCard(afterThird, 'p1', 'c-3', 3);

    expect(afterFourth.gamePhase).toBe('playing');
    const ended = endTurn(afterFourth, 'p1');
    expect(ended.currentPlayerIndex).toBe(1);
  });
});

describe('mid-turn loss detection', () => {
  it('marks game as lost when active player has zero legal moves after a play', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [
        card(29), card(12), card(13), card(14), card(15),
        card(16), card(17), card(18), card(19), card(20),
        card(21), card(22)
      ]
    });

    const rigged = {
      ...state,
      players: [
        { ...state.players[0]!, hand: [card(29), card(12), card(13), card(14), card(15)] },
        { ...state.players[1]! }
      ],
      drawPile: [card(23)],
      foundationPiles: [
        { id: 0, type: 'ascending' as const, topCard: card(18) },
        { id: 1, type: 'ascending' as const, topCard: card(30) },
        { id: 2, type: 'descending' as const, topCard: card(10) },
        { id: 3, type: 'descending' as const, topCard: card(11) }
      ]
    };

    const afterPlay = playCard(rigged, 'p1', 'c-29', 0);
    expect(afterPlay.cardsPlayedThisTurn).toBe(1);
    expect(afterPlay.gamePhase).toBe('lost');
  });
});

describe('solitaire loss detection', () => {
  it('marks game as lost when no legal plays remain', () => {
    const solitaireConfig: GameSettings = {
      minCardValue: 2,
      maxCardValue: 99,
      handSize: 7,
      minPlayers: 1,
      maxPlayers: 1,
      minCardsPerTurn: 2,
      autoRefillHand: true,
      allowUndo: false,
      privateGame: false
    };

    const state = createStartedGameState({
      gameId: 'SOLITR',
      hostId: 'solo',
      players: [{ id: 'solo', name: 'Solo' }],
      settings: solitaireConfig,
      isSolitaire: true,
      deck: buildDeck(solitaireConfig)
    });

    const blocked = {
      ...state,
      players: [{ ...state.players[0]!, hand: [card(12), card(14), card(17), card(18), card(19), card(21), card(31)] }],
      drawPile: [],
      foundationPiles: [
        { id: 0, type: 'ascending' as const, topCard: card(36) },
        { id: 1, type: 'ascending' as const, topCard: card(38) },
        { id: 2, type: 'descending' as const, topCard: card(2) },
        { id: 3, type: 'descending' as const, topCard: card(13) }
      ]
    };

    const next = playCard(blocked, 'solo', 'c-12', 2);
    expect(next.gamePhase).toBe('lost');
  });
});

const cheatSettings = (limits: Partial<Record<'lookup' | 'skip' | 'trade' | 'hint', 'off' | 'once' | 'unlimited'>>): GameSettings => ({
  ...settings,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', ...limits }
});
const table = (limits: Parameters<typeof cheatSettings>[0], players = 3) => createStartedGameState({
  gameId: 'ABC123',
  hostId: 'p1',
  players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` })),
  settings: cheatSettings(limits),
  isSolitaire: false,
  deck: buildDeck(settings)
});

describe('trade', () => {
  it('swaps a hand card for the next draw card, and the handed over card goes back into the pile', () => {
    const state = table({ trade: 'once' });
    const traded = state.players[0]!.hand[0]!;
    const next = state.drawPile[0]!;
    const out = tradeCard(state, 'p1', traded.id);
    expect(out.players[0]!.hand).toHaveLength(state.players[0]!.hand.length);
    expect(out.players[0]!.hand.map((c) => c.id)).toContain(next.id);
    expect(out.players[0]!.hand.map((c) => c.id)).not.toContain(traded.id);
    expect(out.drawPile.map((c) => c.id)).toContain(traded.id);
    // Nothing is lost or made up: every card is still in the game exactly once.
    const ids = (s: typeof state) => [...s.drawPile, ...s.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
    expect(ids(out)).toEqual(ids(state));
    expect(out.statistics.players.p1!.tradesUsed).toBe(1);
  });

  it('puts the handed over card at a random place, chosen by the caller\'s random source', () => {
    const state = table({ trade: 'unlimited' });
    const traded = state.players[0]!.hand[0]!;
    const atStart = tradeCard(state, 'p1', traded.id, () => 0);
    const atEnd = tradeCard(state, 'p1', traded.id, () => 0.999999);
    expect(atStart.drawPile[0]!.id).toBe(traded.id);
    expect(atEnd.drawPile.at(-1)!.id).toBe(traded.id);
  });

  it('is off unless the game allows it, and under "once" only the first use works', () => {
    expect(() => tradeCard(table({}), 'p1', 'c-2')).toThrow(EngineError);
    const once = table({ trade: 'once' });
    const after = tradeCard(once, 'p1', once.players[0]!.hand[0]!.id);
    expect(() => tradeCard(after, 'p1', after.players[0]!.hand[0]!.id)).toThrow('already used');
    const unlimited = table({ trade: 'unlimited' });
    const twice = tradeCard(tradeCard(unlimited, 'p1', unlimited.players[0]!.hand[0]!.id), 'p1', unlimited.players[0]!.hand[1]!.id);
    expect(twice.statistics.players.p1!.tradesUsed).toBe(2);
  });

  it('is only for the active player, and needs a card in the draw pile', () => {
    const state = table({ trade: 'unlimited' });
    expect(() => tradeCard(state, 'p2', state.players[1]!.hand[0]!.id)).toThrow('active player');
    expect(() => tradeCard({ ...state, drawPile: [] }, 'p1', state.players[0]!.hand[0]!.id)).toThrow('draw pile');
  });

  it('counts the swap as a trade for a game that still has the old Nas count', () => {
    const state = table({ trade: 'unlimited' });
    const legacy = { ...state, statistics: { ...state.statistics, players: { ...state.statistics.players, p1: { ...state.statistics.players.p1!, nasCheatsUsed: 2 } } } };
    expect(tradeCard(legacy, 'p1', legacy.players[0]!.hand[0]!.id).statistics.players.p1).toMatchObject({ nasCheatsUsed: 2, tradesUsed: 1 });
  });
});

describe('skip', () => {
  it('passes the turn without the minimum, counts the use, and does not refill the hand', () => {
    const state = table({ skip: 'once' });
    const out = skipTurn(state, 'p1');
    expect(out.currentPlayerIndex).toBe(1);
    expect(out.statistics.players.p1!.skipsUsed).toBe(1);
    expect(out.players[0]!.hand).toEqual(state.players[0]!.hand);
    expect(out.cardsPlayedThisTurn).toBe(0);
    expect(out.gamePhase).toBe('playing');
  });

  it('is only for the active player, never in solitaire, never after a card was played this turn', () => {
    const state = table({ skip: 'unlimited' });
    expect(() => skipTurn(state, 'p2')).toThrow('active player');
    expect(() => skipTurn({ ...state, cardsPlayedThisTurn: 1 }, 'p1')).toThrow('before playing a card');
    expect(() => skipTurn({ ...state, isSolitaire: true }, 'p1')).toThrow(EngineError);
  });

  it('is off unless allowed, and under "once" works one time only', () => {
    expect(() => skipTurn(table({}), 'p1')).toThrow('not enabled');
    const once = table({ skip: 'once' });
    const afterFirst = skipTurn(once, 'p1');
    // Come back round to p1 with no card played in between: still refused, p1 has used their skip.
    const backToP1 = { ...afterFirst, currentPlayerIndex: 0 };
    expect(() => skipTurn(backToP1, 'p1')).toThrow('already used');
  });

  // A table of unlimited skippers must not stall the game for ever.
  it('ends the game as a loss when everyone has skipped in a row without a card being played', () => {
    let state = table({ skip: 'unlimited' });
    state = skipTurn(state, 'p1');
    state = skipTurn(state, 'p2');
    expect(state.gamePhase).toBe('playing');
    state = skipTurn(state, 'p3');
    expect(state.gamePhase).toBe('lost');
  });

  it('starts the count again when a card is played', () => {
    let state = table({ skip: 'unlimited' });
    state = skipTurn(state, 'p1');
    state = skipTurn(state, 'p2');
    // p3 plays a card on a pile, which breaks the run of skips.
    const p3 = state.players[2]!;
    const play = p3.hand.flatMap((card) => state.foundationPiles.filter((pile) => isValidPlay(card, pile)).map((pile) => ({ card, pile })))[0]!;
    state = playCard(state, 'p3', play.card.id, play.pile.id);
    expect(state.consecutiveSkips).toBe(0);
  });
});

describe('recording a cheat that does not change the game', () => {
  it('counts a card lookup, refuses it when off, and refuses a second one under "once"', () => {
    expect(() => recordCheatUse(table({}), 'p1', 'lookup')).toThrow('not enabled');
    const once = table({ lookup: 'once' });
    const counted = recordCheatUse(once, 'p1', 'lookup');
    expect(counted.statistics.players.p1!.lookupsUsed).toBe(1);
    expect(() => recordCheatUse(counted, 'p1', 'lookup')).toThrow('already used');
    const many = recordCheatUse(recordCheatUse(table({ lookup: 'unlimited' }), 'p1', 'lookup'), 'p1', 'lookup');
    expect(many.statistics.players.p1!.lookupsUsed).toBe(2);
  });

  it('reads the old card seeker switch when no limits were given', () => {
    const old = createStartedGameState({
      gameId: 'ABC123', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      settings: { ...settings, allowCardLookup: true }, isSolitaire: false, deck: buildDeck(settings)
    });
    expect(recordCheatUse(old, 'p1', 'lookup').statistics.players.p1!.lookupsUsed).toBe(1);
  });
});

// After a kick the removed seat's cards are back in the draw pile. Hands refill from it only when the game refills hands.
describe('settleAfterRemoval', () => {
  const live = (autoRefillHand: boolean) => createStartedGameState({
    gameId: 'ABC123',
    hostId: 'p1',
    players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    settings: { ...settings, autoRefillHand },
    isSolitaire: false,
    deck: buildDeck(settings)
  });

  it('tops hands back up from the draw pile when hands refill as cards are played', () => {
    const state = live(true);
    state.players[0]!.hand = state.players[0]!.hand.slice(0, 2);
    const settled = settleAfterRemoval(state);
    expect(settled.players[0]!.hand).toHaveLength(5);
    expect(settled.drawPile).toHaveLength(state.drawPile.length - 3);
    expect(settled.gamePhase).toBe('playing');
  });

  it('does not call the game won while the draw pile can still fill an empty hand', () => {
    const state = live(true);
    for (const player of state.players) player.hand = [];
    expect(state.drawPile.length).toBeGreaterThan(0);
    expect(settleAfterRemoval(state).gamePhase).toBe('playing');
  });

  it('wins when every hand and the draw pile are empty', () => {
    const state = live(true);
    for (const player of state.players) player.hand = [];
    state.drawPile = [];
    expect(settleAfterRemoval(state).gamePhase).toBe('won');
  });

  it('leaves the game alone when hands only fill at the end of a turn', () => {
    const state = live(false);
    state.players[0]!.hand = state.players[0]!.hand.slice(0, 2);
    expect(settleAfterRemoval(state)).toBe(state);
  });
});

describe('dealing from a deck that is too small', () => {
  // A short deal silently gave some players fewer cards than others; the game must refuse to start instead.
  it('refuses to start when the deck cannot give every player a full hand', () => {
    const small: GameSettings = { ...settings, maxCardValue: 19, handSize: 11 };
    expect(() => createStartedGameState({
      gameId: 'ABC123', hostId: 'p1',
      players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      settings: small, isSolitaire: false, deck: buildDeck(small)
    })).toThrow(EngineError);
  });
});
