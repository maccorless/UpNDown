import { buildDeck, createStartedGameState } from '@upndown/engine';
import { render, renderHook, screen } from '@testing-library/react';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { cheatNoticeText, cheatStatuses, useCheatHotkeys } from './cheats.js';
import { SettingsDialog } from './SettingsDialog.js';

// The Nas check has no setting of its own: it is on whenever the game has another cheat on, so the card seeker's limit stands in.
const settings = (lookup: 'off' | 'once' | 'unlimited'): GameSettings => ({
  ...defaultMultiplayerSettings, cheatLimits: { lookup, skip: 'off', trade: 'off', hint: 'off' }
});
const table = (lookup: 'off' | 'once' | 'unlimited', names: [string, string]) => createStartedGameState({
  gameId: 'G', hostId: 'a', players: [{ id: 'a', name: names[0] }, { id: 'b', name: names[1] }], settings: settings(lookup), isSolitaire: false, deck: buildDeck(settings(lookup))
});

describe('the Nas check in the cheats a game offers', () => {
  // Only a player named Nas is offered the check. Everybody else is offered nothing for it.
  it('is offered to a player named Nas, with the game\'s own limit', () => {
    const state = table('once', ['Nas', 'Ken']);
    const forNas = cheatStatuses(state, 'a', null).find((status) => status.kind === 'nas');
    expect(forNas).toMatchObject({ kind: 'nas', limit: 'unlimited', available: true });
    expect(cheatStatuses(state, 'b', null).some((status) => status.kind === 'nas')).toBe(false);
  });

  it('is not offered at all while the game has it off', () => {
    expect(cheatStatuses(table('off', ['Nas', 'Ken']), 'a', null).some((status) => status.kind === 'nas')).toBe(false);
  });

  it('tells the other players when a full Monty is used, by name, and never says what it showed', () => {
    expect(cheatNoticeText({ kind: 'monty', playerName: 'Ken' })).toBe('Ken used The Full Monty');
  });
});

describe('the Nas check hotkey', () => {
  it('is Ctrl or Cmd with Shift and K, and calls the check', () => {
    const onNas = vi.fn();
    renderHook(() => useCheatHotkeys({ active: true, onNas }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(onNas).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, shiftKey: true, bubbles: true }));
    expect(onNas).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, bubbles: true }));
    expect(onNas).toHaveBeenCalledTimes(2);
  });
});

describe('the Nas check in Settings', () => {
  const dialog = (settingsForGame: GameSettings, mode: 'multiplayer' | 'solitaire') => (
    <SettingsDialog mode={mode} open settings={settingsForGame} editable validationError={null} saveError={null} onClose={vi.fn()} onSave={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />
  );

  // The Nas check is an easter egg: it has no row, no hint and no name in Settings, whatever the game's cheats are.
  it('is not in Settings at all, so nobody is told it exists', () => {
    render(dialog(settings('unlimited'), 'multiplayer'));
    expect(screen.queryByRole('radiogroup', { name: 'Nas check' })).toBeNull();
    expect(screen.queryByText(/Ctrl\/Cmd-Shift-K/)).toBeNull();
  });

  it('is not offered in solitaire', () => {
    render(dialog({ ...defaultSolitaireSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off' } }, 'solitaire'));
    expect(screen.queryByRole('radiogroup', { name: 'Nas check' })).toBeNull();
  });
});
