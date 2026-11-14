import { solitaireResultPayloadSchema, type GameState, type SolitaireResultPayload } from '@upndown/shared-types';

// Solitaire runs entirely in the browser and needs no connection. The one thing it ever sends is this: when a signed-in
// player finishes a game, its result, so it can go into their history.
const SOLO_PLAYER_ID = 'solo-player';

// One id per game. It is kept in the saved game, so a game finished after a reload still has the id it started with.
export function newRunId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildSolitairePayload(state: GameState, runId: string): SolitaireResultPayload | null {
  if (state.gamePhase !== 'won' && state.gamePhase !== 'lost') return null;
  const mine = state.statistics.players[SOLO_PLAYER_ID] ?? { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0 };
  const now = Date.now();
  const payload = {
    gameId: runId,
    outcome: state.gamePhase,
    startedAtMs: state.statistics.startedAtMs ?? now,
    endedAtMs: state.statistics.endedAtMs ?? now,
    turns: state.statistics.turns,
    cardsTotal: state.settings.maxCardValue - state.settings.minCardValue + 1,
    cardsLeft: state.drawPile.length + state.players.reduce((sum, player) => sum + player.hand.length, 0),
    cardsPlayed: mine.cardsPlayed,
    totalMovement: mine.totalMovement,
    specialPlays: mine.specialPlays,
    nasCheats: mine.nasCheatsUsed,
    settings: state.settings
  };
  // The server applies the same checks. A game that cannot pass them is not sent, rather than sent to be refused.
  const checked = solitaireResultPayloadSchema.safeParse(payload);
  return checked.success ? (payload as SolitaireResultPayload) : null;
}

export async function postSolitaireResult(payload: SolitaireResultPayload): Promise<boolean> {
  try {
    const response = await fetch('/api/me/solitaire-results', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch {
    return false;
  }
}
