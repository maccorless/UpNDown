import { buildDeck, createStartedGameState } from '@upndown/engine';
import { render, screen, within } from '@testing-library/react';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings, type MontyCell } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { cheatStatuses } from './cheats.js';
import { FullMontyModal } from './FullMonty.js';
import { SettingsDialog } from './SettingsDialog.js';

// Cards 2 to 59 are in this game: 2 to 9 played, 10 in the draw pile, 20 in a hand. Everything else from 1 to 100 is gray.
const cells = (): MontyCell[] => Array.from({ length: 100 }, (_, i) => {
  const value = i + 1;
  if (value < 2 || value > 59) return 'out';
  if (value === 10) return 'draw';
  if (value === 20) return 'hand';
  return 'played';
});

describe('the full Monty grid', () => {
  it('shows every card from 1 to 100, and gray for the ones that are not in this game', () => {
    render(<FullMontyModal cells={cells()} onClose={vi.fn()} />);
    const grid = within(screen.getByRole('list', { name: 'Every card from 1 to 100' }));
    const items = grid.getAllByRole('listitem');
    expect(items).toHaveLength(100);
    expect(items[0]!.className).toContain('monty-out');
    expect(items[59]!.className).toContain('monty-out');
    expect(items[9]!.className).toContain('monty-draw');
    expect(items[19]!.className).toContain('monty-hand');
    expect(items[1]!.className).toContain('monty-played');
  });

  // Color is never the only signal: each cell says where its card is, and the summary counts them.
  it('says where each card is in words as well as by color, and sums the counts up', () => {
    render(<FullMontyModal cells={cells()} onClose={vi.fn()} />);
    expect(screen.getByRole('listitem', { name: '10, In the draw pile' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: '60, Not one of this game’s cards' })).toBeTruthy();
    expect(screen.getByText(/1 in the draw pile, 1 in hands, 56 played\. 42 are not cards in this game\./)).toBeTruthy();
  });
});

describe('the full Monty among the cheats', () => {
  const settingsWith = (monty: 'off' | 'unlimited'): GameSettings => ({ ...defaultMultiplayerSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off', monty } });
  const table = (names: [string, string], monty: 'off' | 'unlimited') => createStartedGameState({
    gameId: 'G', hostId: 'a', players: [{ id: 'a', name: names[0] }, { id: 'b', name: names[1] }], settings: settingsWith(monty), isSolitaire: false, deck: buildDeck(settingsWith(monty))
  });

  it('is offered to every player, whatever their name, while the game has it on', () => {
    const state = table(['Ken', 'Ann'], 'unlimited');
    expect(cheatStatuses(state, 'a', null).some((status) => status.kind === 'monty' && status.available)).toBe(true);
    expect(cheatStatuses(state, 'b', null).some((status) => status.kind === 'monty' && status.available)).toBe(true);
  });

  it('is not offered while the game has it off', () => {
    expect(cheatStatuses(table(['Ken', 'Ann'], 'off'), 'a', null).some((status) => status.kind === 'monty')).toBe(false);
  });
});

describe('the full Monty row in Settings', () => {
  const dialog = (settings: GameSettings, mode: 'multiplayer' | 'solitaire') => (
    <SettingsDialog mode={mode} open settings={settings} editable validationError={null} saveError={null} onClose={vi.fn()} onSave={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />
  );

  // Unlike the Nas check, it has no name to match, so it is offered in solitaire as well.
  it('is one of the cheats in a multiplayer game and in solitaire', () => {
    const { unmount } = render(dialog({ ...defaultMultiplayerSettings }, 'multiplayer'));
    expect(screen.getByRole('radiogroup', { name: 'The full Monty' })).toBeTruthy();
    unmount();
    render(dialog({ ...defaultSolitaireSettings }, 'solitaire'));
    expect(screen.getByRole('radiogroup', { name: 'The full Monty' })).toBeTruthy();
  });
});
