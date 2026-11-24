import { emptyPlayerStats } from '@upndown/engine';
import { render, screen } from '@testing-library/react';
import { defaultMultiplayerSettings, type GameState, type PlayerStatistics } from '@upndown/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { specialFlashLabel, statsHighlights } from './board-helpers.js';
import { SettingsDialog } from './SettingsDialog.js';

// A table of seats, each with the stats given for it. Only the fields the callouts read are filled in properly.
const table = (stats: Record<string, Partial<PlayerStatistics>>) => ({
  players: Object.keys(stats).map((id) => ({ id, name: id.toUpperCase(), hand: [], isHost: id === 'a' })),
  statistics: {
    turns: 1,
    startedAtMs: 0,
    endedAtMs: 1,
    players: Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, { ...emptyPlayerStats(), ...s }]))
  }
}) as unknown as Pick<GameState, 'players' | 'statistics'>;

describe('the end-of-game callouts for lifelines and marks followed', () => {
  it('names everyone tied for the most lifelines, because a tie has no single winner', () => {
    expect(statsHighlights(table({ a: { lifelines: 2 }, b: { lifelines: 2 }, c: { lifelines: 1 } })).topLifelines).toEqual({ names: ['A', 'B'], count: 2 });
  });

  it('names nobody when no one found a lifeline or had a mark followed, so the screen shows no empty callout', () => {
    const highlights = statsHighlights(table({ a: {}, b: {} }));
    expect(highlights.topLifelines).toBeNull();
    expect(highlights.topFollows).toBeNull();
  });

  it('ranks marks followed by the follows themselves, not by how many cards a player played', () => {
    expect(statsHighlights(table({ a: { markFollows: 3, cardsPlayed: 40 }, b: { markFollows: 1, cardsPlayed: 90 } })).topFollows).toEqual({ names: ['A'], count: 3 });
  });
});

describe('the flash over a pile', () => {
  it('says Lifeline for a lifeline, and the usual 10 for any other backward 10', () => {
    expect(specialFlashLabel('ascending', true)).toBe('🔥 Lifeline! 🔥');
    expect(specialFlashLabel('ascending', false)).toBe('🔥 -10! 🔥');
    expect(specialFlashLabel('descending', false)).toBe('🔥 +10! 🔥');
  });
});

describe('the cheats section in Settings, for a phone', () => {
  it('says where the cheat panel opens from on a phone, since the keyboard shortcuts do not apply there', () => {
    render(
      <SettingsDialog mode="multiplayer" open settings={defaultMultiplayerSettings} editable validationError={null} saveError={null} onClose={vi.fn()} onSave={vi.fn()} onChange={vi.fn()} enableSounds onToggleSounds={vi.fn()} showArrows onToggleArrows={vi.fn()} autoMark={false} onToggleAutoMark={vi.fn()} />
    );
    const line = screen.getByTestId('settings-cheats-phone').textContent ?? '';
    expect(line).toMatch(/Cheats button/);
    expect(line).toMatch(/double tap the logo/);
  });
});
