import { cheatsAllowedBy, type GameSettings, type ResultRow } from '@upndown/shared-types';
import type { GameResultRow } from './store.js';

// What is stored for a row that did not come from a game the server watched: only the settings the profile reads.
// toResultRow prefers these two flags when they are there, and works them out from full settings otherwise.
export function reducedSettings(r: ResultRow): Record<string, unknown> {
  return {
    handSize: r.handSize,
    minCardsPerTurn: r.minCardsPerTurn,
    minCardValue: r.maxCard - r.cardsTotal + 1,
    maxCardValue: r.maxCard,
    cheatsAllowed: r.cheatsAllowed,
    undoAllowed: r.undoAllowed
  };
}

export function toStoredRow(userId: string, r: ResultRow): GameResultRow {
  return {
    userId,
    gameId: r.gameId,
    mode: r.mode,
    outcome: r.outcome,
    startedAt: new Date(r.startedAtMs),
    endedAt: new Date(r.endedAtMs),
    durationMs: r.durationMs,
    turns: r.turns,
    playerCount: r.playerCount,
    cardsTotal: r.cardsTotal,
    cardsLeft: r.cardsLeft,
    myCardsPlayed: r.cardsPlayed,
    myTotalMovement: r.totalMovement,
    mySpecialPlays: r.specialPlays,
    // The old name for trades is never written again; trades live in my_trades.
    myNasCheats: 0,
    mySkips: r.skips,
    myTrades: r.trades,
    myLookups: r.lookups,
    myHints: r.hints,
    robotCount: r.robotCount,
    myUndos: r.undos,
    myReactions: r.marks,
    playedLastCard: r.playedLastCard,
    myLifelines: r.lifelines,
    myMarkFollows: r.markFollows,
    handSize: r.handSize,
    minCardsPerTurn: r.minCardsPerTurn,
    maxCard: r.maxCard,
    settings: reducedSettings(r)
  };
}

export function toResultRow(r: GameResultRow): ResultRow {
  const s = r.settings as Partial<Record<string, unknown>>;
  return {
    gameId: r.gameId,
    mode: r.mode,
    outcome: r.outcome,
    startedAtMs: r.startedAt.getTime(),
    endedAtMs: r.endedAt.getTime(),
    durationMs: r.durationMs,
    turns: r.turns,
    playerCount: r.playerCount,
    robotCount: r.robotCount,
    cardsTotal: r.cardsTotal,
    cardsLeft: r.cardsLeft,
    cardsPlayed: r.myCardsPlayed,
    totalMovement: r.myTotalMovement,
    specialPlays: r.mySpecialPlays,
    skips: r.mySkips,
    // A row from before migration 003 counted trades in my_nas_cheats.
    trades: r.myTrades + r.myNasCheats,
    lookups: r.myLookups,
    hints: r.myHints,
    undos: r.myUndos,
    marks: r.myReactions,
    playedLastCard: r.playedLastCard,
    lifelines: r.myLifelines,
    markFollows: r.myMarkFollows,
    handSize: r.handSize,
    minCardsPerTurn: r.minCardsPerTurn,
    maxCard: r.maxCard,
    cheatsAllowed: typeof s.cheatsAllowed === 'boolean' ? s.cheatsAllowed : cheatsAllowedBy(s as Pick<GameSettings, 'allowCardLookup' | 'cheatLimits'>),
    undoAllowed: typeof s.undoAllowed === 'boolean' ? s.undoAllowed : s.allowUndo === true
  };
}
