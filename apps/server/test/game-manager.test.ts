import { describe, expect, it } from 'vitest';
import { GameManager, defaultMultiplayerSettings } from '../src/game-manager.js';

function startUndoGame() {
  const manager = new GameManager();
  const created = manager.createGame('host', {
    playerName: 'Host',
    settings: { ...defaultMultiplayerSettings, allowUndo: true },
    isSolitaire: false
  });
  manager.joinGame('guest', { gameId: created.gameId, playerName: 'Guest' });
  const started = manager.startGame('host', created.gameId);
  return { manager, gameId: started.gameId, started };
}

describe('GameManager', () => {
  it('does not record an undo snapshot for a play the engine rejects', () => {
    const { manager, gameId, started } = startUndoGame();
    const activeId = started.players[started.currentPlayerIndex]!.id;
    const inactiveId = started.players.find((p) => p.id !== activeId)!.id;
    const card = started.players[started.currentPlayerIndex]!.hand[0]!;

    expect(() => manager.playCard('stranger', { gameId, cardId: card.id, pileId: 0 })).toThrow();
    expect(() => manager.playCard(inactiveId, { gameId, cardId: card.id, pileId: 0 })).toThrow();

    expect(() => manager.undoLastPlay(activeId, gameId)).toThrowError('Nothing to undo');
  });

  it('restores the exact pre-play state when a legal play is undone', () => {
    const { manager, gameId, started } = startUndoGame();
    const activeId = started.players[started.currentPlayerIndex]!.id;
    const hand = started.players[started.currentPlayerIndex]!.hand;

    let played: ReturnType<GameManager['playCard']> | null = null;
    for (const card of hand) {
      for (let pileId = 0; pileId < started.foundationPiles.length && !played; pileId += 1) {
        try {
          played = manager.playCard(activeId, { gameId, cardId: card.id, pileId });
        } catch {
          played = null;
        }
      }
      if (played) break;
    }
    expect(played).not.toBeNull();

    const restored = manager.undoLastPlay(activeId, gameId);
    expect(restored).toEqual(started);
  });

  it('issues unique six-character game ids from the full A-Z0-9 alphabet', () => {
    const manager = new GameManager();
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const created = manager.createGame(`host-${i}`, {
        playerName: 'Host',
        settings: defaultMultiplayerSettings,
        isSolitaire: false
      });
      expect(created.gameId).toMatch(/^[A-Z0-9]{6}$/);
      ids.add(created.gameId);
    }
    expect(ids.size).toBe(2000);
  });

  it('drops joinable lobby rooms that have zero active connections', () => {
    const manager = new GameManager();
    const hostId = 'host-1';
    const created = manager.createGame(hostId, {
      playerName: 'Host',
      settings: defaultMultiplayerSettings,
      isSolitaire: false
    });

    const activeList = manager.listJoinableGames(new Set([hostId]));
    expect(activeList.some((game) => game.gameId === created.gameId)).toBe(true);

    const noActiveList = manager.listJoinableGames(new Set());
    expect(noActiveList.some((game) => game.gameId === created.gameId)).toBe(false);

    expect(() =>
      manager.joinGame('guest-1', { gameId: created.gameId, playerName: 'Guest' })
    ).toThrowError('Game not found');
  });
});
