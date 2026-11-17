import { emptyPlayerStats } from '@upndown/engine';
import { cheatsAllowedBy, type GameState, type ResultRow } from '@upndown/shared-types';

const MAX_PLAY_MS = 24 * 24 * 3_600_000;

// One player's row for a game, from the state the player sees. The server builds its rows with this too, so a guest's row
// and the server's row for the same game agree.
export function resultRowFromState(a: { state: GameState; runId: string; outcome: ResultRow['outcome']; playerId: string; nowMs: number }): ResultRow {
  const { state, runId, outcome, playerId, nowMs } = a;
  const mine = state.statistics.players[playerId] ?? emptyPlayerStats();
  const mode = state.isSolitaire ? 'solitaire' : 'multiplayer';
  const endedAtMs = Math.max(state.statistics.startedAtMs ?? nowMs, outcome === 'abandoned' ? nowMs : state.statistics.endedAtMs ?? nowMs);
  // A tab left open for weeks reports the most the store accepts, not nothing.
  const startedAtMs = Math.max(state.statistics.startedAtMs ?? nowMs, endedAtMs - MAX_PLAY_MS);
  const won = outcome === 'won';
  const finishedById = state.statistics.finishedById;
  return {
    gameId: runId,
    mode,
    outcome,
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    turns: state.statistics.turns,
    playerCount: state.players.length,
    robotCount: state.players.filter((p) => p.robot).length,
    cardsTotal: state.settings.maxCardValue - state.settings.minCardValue + 1,
    cardsLeft: state.drawPile.length + state.players.reduce((sum, p) => sum + p.hand.length, 0),
    cardsPlayed: mine.cardsPlayed,
    totalMovement: mine.totalMovement,
    specialPlays: mine.specialPlays,
    skips: mine.skipsUsed,
    // The old card swap counted as a trade, so the two are added (as the stored columns are read).
    trades: mine.tradesUsed + mine.nasCheatsUsed,
    lookups: mine.lookupsUsed,
    hints: mine.hintsUsed,
    undos: mine.undosUsed,
    marks: mine.marksPlaced,
    // A game won before winners were recorded has no winner to name: unknown, not "no".
    playedLastCard: won ? (finishedById === undefined ? null : finishedById === playerId) : false,
    handSize: state.settings.handSize,
    minCardsPerTurn: state.settings.minCardsPerTurn,
    maxCard: state.settings.maxCardValue,
    cheatsAllowed: cheatsAllowedBy(state.settings),
    undoAllowed: state.settings.allowUndo
  };
}
