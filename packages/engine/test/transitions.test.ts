import { describe, expect, it } from 'vitest';
import type { Card, GameSettings } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { EngineError } from '../src/errors.js';
import { createStartedGameState, endTurn, playCard } from '../src/transitions.js';

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

  it('allows partial initial deal when deck cannot satisfy full hands', () => {
    const state = createStartedGameState({
      gameId: 'ABC123',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Host' },
        { id: 'p2', name: 'Player 2' }
      ],
      settings,
      isSolitaire: false,
      deck: [card(2), card(3), card(4)]
    });

    expect(state.players[0]?.hand.length).toBe(2);
    expect(state.players[1]?.hand.length).toBe(1);
    expect(state.drawPile.length).toBe(0);
    expect(state.gamePhase).toBe('playing');
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

  it('marks game as lost immediately when active player has zero legal moves', () => {
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

    expect(afterFourth.gamePhase).toBe('lost');
    expect(() => endTurn(afterFourth, 'p1')).toThrowError(EngineError);
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
