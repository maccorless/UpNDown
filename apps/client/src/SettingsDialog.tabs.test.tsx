import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog.js';

function open(settings: GameSettings, { mode = 'multiplayer', editable = true }: { mode?: 'solitaire' | 'multiplayer'; editable?: boolean } = {}) {
  const fns = { onChange: vi.fn(), onSave: vi.fn(), onClose: vi.fn(), onToggleSounds: vi.fn(), onToggleArrows: vi.fn(), onToggleAutoMark: vi.fn() };
  render(<SettingsDialog mode={mode} open settings={settings} editable={editable} validationError={null} {...fns} enableSounds showArrows autoMark={false} />);
  return fns;
}
const mineTab = () => screen.getByRole('tab', { name: /My settings/ });

describe('settings are split by who they affect', () => {
  it('opens on the game rules, and says they apply to everyone at the table', () => {
    open(defaultMultiplayerSettings);
    expect(screen.getByRole('tab', { name: /Game rules/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toContain('apply to everyone at the table');
  });

  it('keeps the player settings on their own tab, and says they are only for you and apply at once', async () => {
    open(defaultMultiplayerSettings);
    expect(screen.queryByRole('switch', { name: /Sound effects/ })).toBeNull();
    await userEvent.click(mineTab());
    expect(screen.getByRole('tabpanel').textContent).toContain('Only you see and hear these');
    for (const name of [/Sound effects/, /Pile arrows/, /Auto-mark piles/]) expect(screen.getByRole('switch', { name })).toBeTruthy();
  });

  it('moves between the tabs with the arrow keys, as tabs do', async () => {
    open(defaultMultiplayerSettings);
    screen.getByRole('tab', { name: /Game rules/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(mineTab().getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(mineTab());
  });

  it('pile arrows are not a game rule any more: the host cannot force them on or off for others', () => {
    open(defaultMultiplayerSettings);
    expect(screen.queryByRole('switch', { name: /Pile arrows/ })).toBeNull();
  });

  it('lets anyone change their own settings even when the game rules are locked, because they are not the table\'s to lock', async () => {
    const fns = open(defaultMultiplayerSettings, { editable: false });
    expect(screen.getByText('View only')).toBeTruthy();
    await userEvent.click(mineTab());
    await userEvent.click(screen.getByRole('switch', { name: /Auto-mark piles/ }));
    expect(fns.onToggleAutoMark).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('switch', { name: /Pile arrows/ }));
    expect(fns.onToggleArrows).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('switch', { name: /Sound effects/ }));
    expect(fns.onToggleSounds).toHaveBeenCalledWith(false);
  });

  it('has no auto-mark in solitaire, where nobody can react to you', async () => {
    open({ ...defaultSolitaireSettings }, { mode: 'solitaire' });
    await userEvent.click(mineTab());
    expect(screen.queryByRole('switch', { name: /Auto-mark piles/ })).toBeNull();
    expect(screen.getByRole('switch', { name: /Pile arrows/ })).toBeTruthy();
  });

  it('offers Save only for the game rules, since the other tab saves as you go', async () => {
    open(defaultMultiplayerSettings);
    expect(screen.getByRole('button', { name: 'Save game rules' })).toBeTruthy();
    await userEvent.click(mineTab());
    expect(screen.queryByRole('button', { name: 'Save game rules' })).toBeNull();
    expect(screen.getByText('Nothing to save on this tab.')).toBeTruthy();
  });

  it('warns on the other tab when game rules have unsaved changes, so closing is never a surprise', async () => {
    const settings = defaultMultiplayerSettings;
    const { rerender } = render(<SettingsDialog mode="multiplayer" open settings={settings} editable validationError={null} onClose={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />);
    rerender(<SettingsDialog mode="multiplayer" open settings={{ ...settings, privateGame: true }} editable validationError={null} onClose={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />);
    await userEvent.click(mineTab());
    expect(screen.getByText(/Game rules have unsaved changes/)).toBeTruthy();
  });
});

describe('game rules, learned in order', () => {
  it('shows what each difficulty means in numbers, computed from the preset and not typed in', () => {
    open(defaultMultiplayerSettings);
    expect(screen.getByRole('radio', { name: /Trivial.*28 cards, hand of 9, play 1/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Hard.*98 cards, hand of 6, play 3/ })).toBeTruthy();
  });

  it('applies a whole level when one is picked', async () => {
    const { onChange } = open(defaultMultiplayerSettings);
    await userEvent.click(screen.getByRole('radio', { name: /Easy/ }));
    expect(onChange.mock.lastCall![0]).toMatchObject({ minCardValue: 2, maxCardValue: 59, handSize: 8, minCardsPerTurn: 1, autoRefillHand: true });
  });

  it('keeps the fine-tuning folded for a standard level but open for a custom one, where the numbers are the point', () => {
    const { unmount } = render(<SettingsDialog mode="multiplayer" open settings={defaultMultiplayerSettings} editable validationError={null} onClose={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />);
    expect(document.querySelector('details.settings-adv')!.hasAttribute('open')).toBe(false);
    unmount();
    open({ ...defaultMultiplayerSettings, handSize: 10 });
    expect(document.querySelector('details.settings-adv')!.hasAttribute('open')).toBe(true);
  });

  it('shows the cheats in the open, as a section of their own', () => {
    open(defaultMultiplayerSettings);
    expect(screen.getByRole('heading', { name: 'Cheats' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Hint' })).toBeTruthy();
  });

  it('asks who can play only at a table', () => {
    open(defaultMultiplayerSettings);
    expect(screen.getByRole('heading', { name: 'Who can play?' })).toBeTruthy();
  });

  it('leaves out that section, and the per-turn count, in solitaire', () => {
    open({ ...defaultSolitaireSettings }, { mode: 'solitaire' });
    expect(screen.queryByRole('heading', { name: 'Who can play?' })).toBeNull();
    expect(screen.getByRole('radio', { name: /Normal.*98 cards, hand of 7$/ })).toBeTruthy();
  });
});
