import { CHEAT_KINDS, cheatLimitOf, deckSizeOf, ROBOT_PAUSE_DEFAULT_MS, type GameSettings } from '@upndown/shared-types';
import type { JSX } from 'react';
import { CHEAT_TITLES } from './cheats.js';

const yesNo = (value: boolean): string => (value ? 'On' : 'Off');

// What the next table will be, in lines a player can check before they host or join.
export function describeMultiplayerSettings(settings: GameSettings): string[] {
  const cheats = CHEAT_KINDS.filter((kind) => kind !== 'nas' && cheatLimitOf(settings, kind) !== 'off')
    .map((kind) => `${CHEAT_TITLES[kind]} (${cheatLimitOf(settings, kind) === 'once' ? 'once' : 'unlimited'})`);
  return [
    `Cards ${settings.minCardValue} to ${settings.maxCardValue} (${deckSizeOf(settings)} cards)`,
    `Hand of ${settings.handSize}, play ${settings.minCardsPerTurn} per turn`,
    `Auto refill hand: ${yesNo(settings.autoRefillHand)}`,
    `Maximum players: ${settings.maxPlayers}`,
    `Private game: ${yesNo(settings.privateGame)}`,
    `Robot pause: ${(settings.robotPauseMs ?? ROBOT_PAUSE_DEFAULT_MS) / 1000} s`,
    cheats.length > 0 ? `Cheats: ${cheats.join(', ')}` : 'No cheats'
  ];
}

// The settings that belong to one person. Solitaire has no marking, so Auto-mark is listed only at a table.
export function MySettingsSummary({ solitaire, enableSounds, showArrows, autoMark = false }: { solitaire: boolean; enableSounds: boolean; showArrows: boolean; autoMark?: boolean }): JSX.Element {
  const lines = [`Sound effects: ${yesNo(enableSounds)}`, `Pile arrows: ${yesNo(showArrows)}`];
  if (!solitaire) lines.push(`Auto-mark piles: ${yesNo(autoMark)}`);
  return (
    <section aria-labelledby="my-settings-title" data-testid="my-settings-summary">
      <h3 id="my-settings-title">My settings</h3>
      <ul className="setup-summary">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="settings-why">Only you see these. Change them under My settings in Settings; they are remembered on this device.</p>
    </section>
  );
}
