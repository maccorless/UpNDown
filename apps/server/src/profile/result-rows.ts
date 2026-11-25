import { resultRowFromState } from '@upndown/profile';
import type { GameState, SolitaireResultPayload } from '@upndown/shared-types';
import { toStoredRow } from './rows.js';
import type { GameResultRow } from './store.js';

// Co-players are not stored (a privacy decision), only how many there were. A row is one player's view of a game:
// the team outcome and that player's own contribution.
export function buildResultRows(args: {
  state: GameState;
  runId: string;
  outcome: 'won' | 'lost' | 'abandoned';
  userIdByPlayerId: ReadonlyMap<string, string>;
  nowMs: number;
  // Abandoned rows belong to the host alone, because only the host chose to stop.
  onlyPlayerId?: string;
}): GameResultRow[] {
  const { state, runId, outcome, userIdByPlayerId, nowMs, onlyPlayerId } = args;
  const rows: GameResultRow[] = [];
  for (const player of state.players) {
    const userId = userIdByPlayerId.get(player.id);
    if (!userId || (onlyPlayerId !== undefined && player.id !== onlyPlayerId)) continue;
    const row = resultRowFromState({ state, runId, outcome, playerId: player.id, nowMs });
    if (!row) continue;
    // A game the server watched keeps its full settings; the shared builder only knows the fields the profile reads.
    const mine = state.statistics.players[player.id];
    rows.push({ ...toStoredRow(userId, row), ...(mine ? { myTrades: mine.tradesUsed, myNasCheats: mine.nasCheatsUsed } : {}), settings: { ...state.settings } });
  }
  return rows;
}

// A solitaire row is built from what the browser reports. Nothing here is checked against a game the server saw.
export function buildSolitaireRow(userId: string, payload: SolitaireResultPayload): GameResultRow {
  return {
    userId,
    gameId: payload.gameId,
    mode: 'solitaire',
    outcome: payload.outcome,
    startedAt: new Date(payload.startedAtMs),
    endedAt: new Date(payload.endedAtMs),
    durationMs: payload.endedAtMs - payload.startedAtMs,
    turns: payload.turns,
    playerCount: 1,
    cardsTotal: payload.cardsTotal,
    cardsLeft: payload.cardsLeft,
    myCardsPlayed: payload.cardsPlayed,
    myTotalMovement: payload.totalMovement,
    mySpecialPlays: payload.specialPlays,
    // Old clients report trades as nasCheats; the column that holds them is the same either way.
    myNasCheats: 0,
    mySkips: payload.skips,
    myTrades: payload.trades + payload.nasCheats,
    myLookups: payload.lookups,
    myHints: payload.hints,
    robotCount: 0,
    myUndos: payload.undos ?? null,
    myReactions: 0,
    // Solitaire has no one to mark a pile for, so no follows. Lifelines are reported by the browser, like the other counts.
    myLifelines: payload.lifelines ?? null,
    myMarkFollows: 0,
    playedLastCard: payload.playedLastCard ?? null,
    handSize: payload.settings.handSize,
    minCardsPerTurn: payload.settings.minCardsPerTurn,
    maxCard: payload.settings.maxCardValue,
    settings: { ...payload.settings }
  };
}

