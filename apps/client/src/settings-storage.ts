import { deckFitMessage, gameSettingsSchema, type GameSettings } from '@upndown/shared-types';

// The settings and player name kept on this device between visits.
export const SETTINGS_STORAGE_KEY = 'upndown.settings.v1';
export const PLAYER_NAME_STORAGE_KEY = 'upndown.multiplayer.playerName.v1';

export interface PersistedSettings {
  solitaire: GameSettings;
  multiplayer: GameSettings;
}

export function normalizeSolitaireSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    minPlayers: 1,
    maxPlayers: 1,
    minCardsPerTurn: 2,
    autoRefillHand: true,
    allowUndo: false,
    privateGame: false
  };
}

export function normalizeMultiplayerSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    minPlayers: Math.max(2, settings.minPlayers),
    maxPlayers: Math.max(2, settings.maxPlayers)
  };
}

export function readPersistedSettings(): PersistedSettings | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const solitaireResult = gameSettingsSchema.safeParse(parsed.solitaire);
    const multiplayerResult = gameSettingsSchema.safeParse(parsed.multiplayer);
    if (!solitaireResult.success || !multiplayerResult.success) {
      return null;
    }

    return {
      solitaire: normalizeSolitaireSettings(solitaireResult.data),
      multiplayer: normalizeMultiplayerSettings(multiplayerResult.data)
    };
  } catch {
    return null;
  }
}

export function writePersistedSettings(settings: PersistedSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures (private mode/quota/etc).
  }
}

export function readPersistedPlayerName(): string {
  try {
    const raw = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (!raw) {
      return '';
    }
    return raw.slice(0, 32);
  } catch {
    return '';
  }
}

export function writePersistedPlayerName(playerName: string): void {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
  } catch {
    // Ignore storage write failures (private mode/quota/etc).
  }
}

export function validateCreateSettings(settings: GameSettings): string | null {
  if (settings.maxPlayers < settings.minPlayers) {
    return 'Max players must be greater than or equal to min players';
  }
  const deckSize = settings.maxCardValue - settings.minCardValue + 1;
  if (deckSize < 18) {
    return 'Deck must contain at least 18 cards';
  }
  return deckFitMessage(settings);
}
