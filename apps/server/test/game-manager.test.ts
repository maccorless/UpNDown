import { describe, expect, it } from 'vitest';
import { GameManager, defaultMultiplayerSettings } from '../src/game-manager.js';

describe('GameManager', () => {
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
