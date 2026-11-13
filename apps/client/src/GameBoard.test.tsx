import { fireEvent, render, screen } from '@testing-library/react';
import type { GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { GameBoard } from './App.js';

const WON_STATE: GameState = {
  gameId: 'LOCAL',
  hostId: 'solo-player',
  players: [
    {
      id: 'solo-player',
      name: 'You',
      hand: [{ id: 'c1', value: 42 }],
      isHost: true
    }
  ],
  foundationPiles: [
    { id: 0, type: 'ascending', topCard: { id: 'p0', value: 1 } },
    { id: 1, type: 'ascending', topCard: { id: 'p1', value: 1 } },
    { id: 2, type: 'descending', topCard: { id: 'p2', value: 100 } },
    { id: 3, type: 'descending', topCard: { id: 'p3', value: 100 } }
  ],
  drawPile: [],
  currentPlayerIndex: 0,
  gamePhase: 'won',
  cardsPlayedThisTurn: 0,
  statistics: {
    turns: 0,
    startedAtMs: Date.now(),
    endedAtMs: Date.now(),
    players: {
      'solo-player': {
        cardsPlayed: 0,
        totalMovement: 0,
        specialPlays: 0,
        nasCheatsUsed: 0
      }
    }
  },
  nasCheat: {
    enabledPlayerIds: [],
    usedThisTurnByPlayerId: {
      'solo-player': false
    }
  },
  settings: {
    minCardValue: 1,
    maxCardValue: 100,
    handSize: 7,
    minPlayers: 1,
    maxPlayers: 1,
    minCardsPerTurn: 2,
    autoRefillHand: true,
    allowUndo: false,
    privateGame: false,
    allowCardLookup: false, showArrows: true
  },
  isSolitaire: true
};

describe('GameBoard', () => {
  it('dismisses end-state splash on Escape', () => {
    render(
      <GameBoard
        mode="solitaire"
        gameState={WON_STATE}
        selectedCardId={null}
        setSelectedCardId={() => {}}
        onPlayPile={() => {}}
      />
    );

    expect(screen.getByTestId('phase-splash')).toBeTruthy();
    expect(screen.queryByTestId('phase-banner')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('phase-splash')).toBeNull();
  });

  // A player who cannot tell how many plays are still owed sits on a disabled End Turn button with no explanation.
  const PLAYING_STATE: GameState = {
    ...WON_STATE,
    hostId: 'p1',
    players: [
      { id: 'p1', name: 'Ken', hand: [{ id: 'c1', value: 33 }, { id: 'c2', value: 60 }], isHost: true, color: 'red' },
      { id: 'p2', name: 'Ann', hand: [{ id: 'c3', value: 70 }, { id: 'c4', value: 80 }], isHost: false, color: 'orange' }
    ],
    foundationPiles: [
      { id: 0, type: 'ascending', topCard: { id: 'p0', value: 43 } },
      { id: 1, type: 'ascending', topCard: { id: 'p1', value: 20 } },
      { id: 2, type: 'descending', topCard: { id: 'p2', value: 84 } },
      { id: 3, type: 'descending', topCard: { id: 'p3', value: 50 } }
    ],
    drawPile: [{ id: 'd1', value: 5 }, { id: 'd2', value: 6 }, { id: 'd3', value: 7 }],
    gamePhase: 'playing',
    cardsPlayedThisTurn: 1,
    isSolitaire: false,
    settings: { ...WON_STATE.settings, minCardValue: 2, maxCardValue: 99, minPlayers: 2, maxPlayers: 6 }
  };

  const renderPlaying = (playerId: string, selectedCardId: string | null) => render(
    <GameBoard
      mode="multiplayer"
      gameState={PLAYING_STATE}
      playerId={playerId}
      selectedCardId={selectedCardId}
      setSelectedCardId={() => {}}
      onPlayPile={() => {}}
      onEndTurn={() => {}}
    />
  );

  it('tells the active player how many of the required plays are done, and nobody else', () => {
    const { unmount } = renderPlaying('p1', null);
    expect(screen.getByTestId('turn-progress').textContent).toBe('1 of 2 played');
    unmount();

    renderPlaying('p2', null);
    expect(screen.queryByTestId('turn-progress')).toBeNull();
  });

  it('badges a pile only when the selected card would be a backward 10 there', () => {
    const { unmount } = renderPlaying('p1', 'c1'); // 33 is exactly 10 below the ascending 43
    expect(screen.getByTestId('pile-0').textContent).toContain('\u221210');
    expect(screen.getByTestId('pile-0').getAttribute('aria-label')).toContain('backward ten');
    expect(screen.getByTestId('pile-1').textContent).not.toContain('10'); // 33 > 20 is an ordinary play
    unmount();

    renderPlaying('p1', 'c2'); // 60 is an ordinary forward play on the ascending 43
    expect(screen.getByTestId('pile-0').textContent).not.toContain('\u221210');
  });

  it('shows cards left across the draw pile and every hand', () => {
    renderPlaying('p1', null);
    expect(screen.getByText('7 left \u00b7 draw pile 3')).toBeTruthy();
  });
});
