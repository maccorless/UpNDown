import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { defaultMultiplayerSettings, defaultSolitaireSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog.js';

const show = (opts: { mode: 'multiplayer' | 'solitaire'; editable: boolean; robotPauseMs?: number; onChange?: () => void }) => render(
  <SettingsDialog mode={opts.mode} open settings={{ ...(opts.mode === 'solitaire' ? defaultSolitaireSettings : defaultMultiplayerSettings), ...(opts.robotPauseMs === undefined ? {} : { robotPauseMs: opts.robotPauseMs }) }} editable={opts.editable} validationError={null} saveError={null} onClose={vi.fn()} onSave={vi.fn()} onChange={opts.onChange ?? vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />
);

describe('the robot pause setting in the dialog', () => {
  it('lets the host choose it, and shows the usual 0.8 s until they do', async () => {
    const onChange = vi.fn();
    show({ mode: 'multiplayer', editable: true, onChange });
    const group = screen.getByRole('radiogroup', { name: 'Pause before each robot play' });
    expect((screen.getByRole('radio', { name: '0.8 s' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: '0.1 s' }));
    expect(group).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ robotPauseMs: 100 }));
  });

  it('shows the host\'s earlier choice', () => {
    show({ mode: 'multiplayer', editable: true, robotPauseMs: 1500 });
    expect((screen.getByRole('radio', { name: '1.5 s' }) as HTMLInputElement).checked).toBe(true);
  });

  it('is only read by a player who is not the host, and absent from solitaire, which has no robots', () => {
    show({ mode: 'multiplayer', editable: false, robotPauseMs: 3000 });
    expect(screen.queryByRole('radiogroup', { name: 'Pause before each robot play' })).toBeNull();
    expect(screen.getByText('Robot pause').nextElementSibling?.textContent).toBe('3 s');
  });

  it('is not offered in solitaire', () => {
    show({ mode: 'solitaire', editable: true });
    expect(screen.queryByRole('radiogroup', { name: 'Pause before each robot play' })).toBeNull();
  });
});
