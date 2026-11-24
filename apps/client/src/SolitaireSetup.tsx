import { CHEAT_KINDS, cheatLimitOf, deckSizeOf, type GameSettings } from '@upndown/shared-types';
import type { JSX } from 'react';
import { CHEAT_TITLES } from './cheats.js';
import { MySettingsSummary } from './setup-summary.js';

// What the next solitaire game will be, in a line a player can check before it starts.
export function describeSolitaireSettings(settings: GameSettings): string[] {
  const cards = deckSizeOf(settings);
  const cheats = CHEAT_KINDS.filter((kind) => kind !== 'skip' && kind !== 'nas' && cheatLimitOf(settings, kind) !== 'off')
    .map((kind) => `${CHEAT_TITLES[kind]} (${cheatLimitOf(settings, kind) === 'once' ? 'once' : 'unlimited'})`);
  return [
    `Cards ${settings.minCardValue} to ${settings.maxCardValue} (${cards} cards)`,
    `Hand of ${settings.handSize}`,
    cheats.length > 0 ? `Cheats: ${cheats.join(', ')}` : 'No cheats'
  ];
}

// The step before a solitaire game: start it, or change the settings first. Settings are fixed once a game is dealt, so this is where to choose them.
export function SolitaireSetup({ settings, enableSounds, showArrows, onStart, onChangeSettings }: { settings: GameSettings; enableSounds: boolean; showArrows: boolean; onStart: () => void; onChangeSettings: () => void }): JSX.Element {
  return (
    <section className="panel lobby" aria-label="solitaire setup" data-testid="solitaire-setup">
      <h2>Solitaire</h2>
      <p>Settings are fixed once the game starts, so check them here first.</p>
      <ul className="setup-summary" data-testid="solitaire-summary">
        {describeSolitaireSettings(settings).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <MySettingsSummary solitaire enableSounds={enableSounds} showArrows={showArrows} />
      <div className="button-row">
        <button type="button" className="primary" onClick={onStart} data-testid="start-solitaire">Start Solitaire</button>
        <button type="button" className="secondary" onClick={onChangeSettings} data-testid="solitaire-change-settings">Change settings</button>
      </div>
    </section>
  );
}
