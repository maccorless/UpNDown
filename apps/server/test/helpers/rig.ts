import type { GameState } from '@upndown/shared-types';
import { GameManager, defaultMultiplayerSettings } from '../../src/game-manager.js';
import type { GameResultRow } from '../../src/profile/store.js';

type Internals = { rooms: Map<string, { gameState: GameState; runId: string | null }> };

// A lobby of `seats` players, each optionally signed in, with a hook that collects every row the manager emits.
export function lobbyWithUsers(seats: Array<{ id: string; userId?: string; name?: string }>, settings = defaultMultiplayerSettings) {
  const batches: GameResultRow[][] = [];
  const manager = new GameManager({ onResults: (rows) => { batches.push(rows); } });
  const [host, ...rest] = seats;
  const created = manager.createGame(host!.id, { playerName: host!.name ?? 'Host', settings: { ...settings, maxPlayers: 6 }, isSolitaire: false }, host!.userId);
  for (const seat of rest) manager.joinGame(seat.id, { gameId: created.gameId, playerName: seat.name ?? seat.id }, seat.userId);
  const gameId = created.gameId;
  const room = () => (manager as unknown as Internals).rooms.get(gameId)!;
  const rows = () => batches.flat();
  return { manager, gameId, batches, rows, room };
}

// Edits the live game state the way a game in progress would look, without playing it out.
export function rig(room: () => { gameState: GameState }, edit: (state: GameState) => void): void {
  const state = structuredClone(room().gameState);
  edit(state);
  room().gameState = state;
}

// Player `activeId` holds one playable card and everyone else is out of cards: playing it wins.
export function setUpWin(state: GameState, activeId: string): void {
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === activeId);
  state.drawPile = [];
  state.cardsPlayedThisTurn = 0;
  for (const p of state.players) p.hand = p.id === activeId ? [{ id: 'c-2', value: 2 }] : [];
}

// The active player may end their turn, and the next player holds a card nothing can take: ending the turn loses.
export function setUpLoss(state: GameState, activeId: string): void {
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === activeId);
  state.drawPile = [];
  state.cardsPlayedThisTurn = 1;
  state.foundationPiles = [
    { id: 0, type: 'ascending', topCard: { id: 'f-0', value: 98 } },
    { id: 1, type: 'ascending', topCard: { id: 'f-1', value: 98 } },
    { id: 2, type: 'descending', topCard: { id: 'f-2', value: 3 } },
    { id: 3, type: 'descending', topCard: { id: 'f-3', value: 3 } }
  ];
  for (const p of state.players) p.hand = [{ id: p.id === activeId ? 'c-60' : 'c-50', value: p.id === activeId ? 60 : 50 }];
}
