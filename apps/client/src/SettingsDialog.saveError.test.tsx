import { render, screen } from '@testing-library/react';
import { defaultMultiplayerSettings } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog.js';

const show = (saveError: string | null) => render(
  <SettingsDialog mode="multiplayer" open settings={defaultMultiplayerSettings} editable validationError={null} saveError={saveError} onClose={vi.fn()} onSave={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />
);

describe('SettingsDialog save error', () => {
  // The page banner sits behind the dialog, so a refused save must be told inside it or Save looks dead.
  it('tells the host inside the dialog why the server refused the save', () => {
    show('Current player count exceeds new max players');
    expect(screen.getByText('Current player count exceeds new max players').getAttribute('role')).toBe('alert');
  });

  it('shows nothing when there is no refusal', () => {
    show(null);
    expect(screen.queryByText('Current player count exceeds new max players')).toBeNull();
    expect(screen.getAllByRole('alert').every((el) => el.textContent === '')).toBe(true);
  });
});
