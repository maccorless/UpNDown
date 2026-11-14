import { emptyPlayerStats } from '@upndown/engine';
import type { GameState } from '@upndown/shared-types';
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
  const startedMs = state.statistics.startedAtMs ?? nowMs;
  // The engine stamps the end of a finished game; an abandoned game ends when the host ends it.
  const endedMs = Math.max(startedMs, outcome === 'abandoned' ? nowMs : state.statistics.endedAtMs ?? nowMs);
  const cardsTotal = state.settings.maxCardValue - state.settings.minCardValue + 1;
  const cardsLeft = state.drawPile.length + state.players.reduce((sum, player) => sum + player.hand.length, 0);

  const rows: GameResultRow[] = [];
  for (const player of state.players) {
    const userId = userIdByPlayerId.get(player.id);
    if (!userId || (onlyPlayerId !== undefined && player.id !== onlyPlayerId)) continue;
    const mine = state.statistics.players[player.id] ?? emptyPlayerStats();
    rows.push({
      userId,
      gameId: runId,
      mode: 'multiplayer',
      outcome,
      startedAt: new Date(startedMs),
      endedAt: new Date(endedMs),
      durationMs: endedMs - startedMs,
      turns: state.statistics.turns,
      playerCount: state.players.length,
      cardsTotal,
      cardsLeft,
      myCardsPlayed: mine.cardsPlayed,
      myTotalMovement: mine.totalMovement,
      mySpecialPlays: mine.specialPlays,
      myNasCheats: mine.nasCheatsUsed,
      handSize: state.settings.handSize,
      minCardsPerTurn: state.settings.minCardsPerTurn,
      maxCard: state.settings.maxCardValue,
      settings: { ...state.settings }
    });
  }
  return rows;
}
