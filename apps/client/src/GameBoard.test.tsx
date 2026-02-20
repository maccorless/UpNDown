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
  settings: {
    minCardValue: 1,
    maxCardValue: 100,
    handSize: 7,
    minPlayers: 1,
    maxPlayers: 1,
    minCardsPerTurn: 2,
    autoRefillHand: true,
    allowUndo: false,
    privateGame: false
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
});
