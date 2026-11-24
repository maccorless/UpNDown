import { buildDeck, createStartedGameState } from '@upndown/engine';
import { defaultSolitaireSettings } from '@upndown/shared-types';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EndGameStatisticsModal } from './EndGame.js';

const lostGame = () => ({ ...createStartedGameState({ gameId: 'SOLO01', hostId: 'solo', players: [{ id: 'solo', name: 'Me' }], settings: defaultSolitaireSettings, isSolitaire: true, deck: buildDeck(defaultSolitaireSettings) }), gamePhase: 'lost' as const });

describe('the end of a solitaire game', () => {
  const props = (over: Partial<Parameters<typeof EndGameStatisticsModal>[0]> = {}) => {
    const state = lostGame();
    return { mode: 'solitaire' as const, gameState: state, statistics: state.statistics, isHost: true, onClose: vi.fn(), onPlayAgain: vi.fn(), onBackToLobby: vi.fn(), ...over };
  };

  it('offers Change settings only when asked to, and calls it', async () => {
    const without = render(<EndGameStatisticsModal {...props()} />);
    expect(screen.queryByTestId('end-change-settings')).toBeNull();
    without.unmount();
    const onChangeSettings = vi.fn();
    render(<EndGameStatisticsModal {...props({ onChangeSettings })} />);
    await userEvent.click(screen.getByTestId('end-change-settings'));
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play Again' })).toBeTruthy();
  });
});

describe('the end of a multiplayer game', () => {
  it('lets a player who is not the host deal the next round, while only the host can go back to the lobby', async () => {
    const state = lostGame();
    const onPlayAgain = vi.fn();
    render(<EndGameStatisticsModal mode="multiplayer" gameState={state} statistics={state.statistics} isHost={false} onClose={vi.fn()} onPlayAgain={onPlayAgain} onBackToLobby={vi.fn()} />);
    const again = screen.getByRole('button', { name: 'Play Again' }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    await userEvent.click(again);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Host Returns to Lobby' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
