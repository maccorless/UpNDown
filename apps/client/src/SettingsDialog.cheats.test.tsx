import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { defaultMultiplayerSettings, type GameSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog.js';

const open = (settings: GameSettings, mode: 'solitaire' | 'multiplayer' = 'multiplayer', editable = true) => {
  const onChange = vi.fn();
  render(<SettingsDialog mode={mode} open settings={settings} editable={editable} validationError={null} onClose={vi.fn()} onSave={vi.fn()} onChange={onChange} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />);
  return onChange;
};
const group = (label: string) => within(screen.getByRole('radiogroup', { name: label }));

describe('cheats in settings (always visible, not tucked away)', () => {
  it('picks off, once or unlimited for each cheat, and writes both the new setting and the old card seeker switch', async () => {
    const onChange = open(defaultMultiplayerSettings);
    await userEvent.click(group('Trade a card').getByLabelText('Once'));
    expect(onChange.mock.lastCall![0]).toMatchObject({ cheatLimits: { trade: 'once', lookup: 'off', skip: 'off', hint: 'off' }, allowCardLookup: false });
    await userEvent.click(group('Card seeker').getByLabelText('Unlimited'));
    expect(onChange.mock.lastCall![0]).toMatchObject({ cheatLimits: { lookup: 'unlimited' }, allowCardLookup: true });
  });

  it('starts from the old switch when the settings predate cheat limits', async () => {
    open({ ...defaultMultiplayerSettings, allowCardLookup: true });
    expect((group('Card seeker').getByLabelText('Unlimited') as HTMLInputElement).checked).toBe(true);
    expect((group('Skip turn').getByLabelText('Off') as HTMLInputElement).checked).toBe(true);
  });

  it('has no skip setting in solitaire, where there is no turn to skip', async () => {
    open({ ...defaultMultiplayerSettings, minPlayers: 1, maxPlayers: 1 }, 'solitaire');
    expect(screen.queryByRole('radiogroup', { name: 'Skip turn' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Trade a card' })).toBeTruthy();
  });

  it('shows each cheat\'s limit in words to someone who cannot change the settings', () => {
    open({ ...defaultMultiplayerSettings, cheatLimits: { lookup: 'once', skip: 'unlimited', trade: 'off', hint: 'off' } }, 'multiplayer', false);
    expect(screen.getByText('Card seeker').nextSibling?.textContent).toBe('Once per game');
    expect(screen.getByText('Skip turn').nextSibling?.textContent).toBe('Unlimited');
    expect(screen.getByText('Trade a card').nextSibling?.textContent).toBe('Off');
    expect(screen.getByText('Hint').nextSibling?.textContent).toBe('Off');
  });
});
