import { buildDeck, createStartedGameState } from '@upndown/engine';
import { render, renderHook, screen, within } from '@testing-library/react';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { cheatNoticeText, cheatStatuses, useCheatHotkeys } from './cheats.js';
import { SettingsDialog } from './SettingsDialog.js';

const settings = (nas: 'off' | 'once' | 'unlimited'): GameSettings => ({
  ...defaultMultiplayerSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas }
});
const table = (nas: 'off' | 'once' | 'unlimited', names: [string, string]) => createStartedGameState({
  gameId: 'G', hostId: 'a', players: [{ id: 'a', name: names[0] }, { id: 'b', name: names[1] }], settings: settings(nas), isSolitaire: false, deck: buildDeck(settings(nas))
});

describe('the Nas check in the cheats a game offers', () => {
  // Only a player named Nas is offered the check. Everybody else is offered nothing for it.
  it('is offered to a player named Nas, with the game\'s own limit', () => {
    const state = table('once', ['Nas', 'Ken']);
    const forNas = cheatStatuses(state, 'a', null).find((status) => status.kind === 'nas');
    expect(forNas).toMatchObject({ kind: 'nas', limit: 'once', available: true });
    expect(cheatStatuses(state, 'b', null).some((status) => status.kind === 'nas')).toBe(false);
  });

  it('is not offered at all while the game has it off', () => {
    expect(cheatStatuses(table('off', ['Nas', 'Ken']), 'a', null).some((status) => status.kind === 'nas')).toBe(false);
  });

  it('tells the other players when a full Monty is used, by name, and never says what it showed', () => {
    expect(cheatNoticeText({ kind: 'monty', playerName: 'Ken' })).toBe('Ken used The full Monty');
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

  // It sits with the other cheats and uses the same off, once, unlimited choice. Solitaire has no name to match, so it is not there.
  it('is one of the cheats in a game, with off, once and unlimited', () => {
    render(dialog(settings('once'), 'multiplayer'));
    const group = within(screen.getByRole('radiogroup', { name: 'Nas check' }));
    expect(group.getByLabelText('Once')).toBeTruthy();
    expect(group.getByLabelText('Unlimited')).toBeTruthy();
  });

  it('is not offered in solitaire', () => {
    render(dialog({ ...defaultSolitaireSettings, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off' } }, 'solitaire'));
    expect(screen.queryByRole('radiogroup', { name: 'Nas check' })).toBeNull();
  });
});
