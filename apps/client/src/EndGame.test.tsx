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
