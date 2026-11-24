import { defaultMultiplayerSettings } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { RejoinRefused } from '../src/game-manager.js';
import { lobbyWithUsers } from './helpers/rig.js';

const reasonOf = (attempt: () => unknown): string => {
  try {
    attempt();
  } catch (err) {
    return err instanceof RejoinRefused ? err.reason : 'other';
  }
  return 'none';
};

// With the skip cheat on, a full round of skips with no card played by anyone ends the game as a loss.
const table = () => lobbyWithUsers(
  [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Ben' }, { id: 'p3', name: 'Cy' }],
  { ...defaultMultiplayerSettings, cheatLimits: { lookup: 'off', skip: 'unlimited', trade: 'off', hint: 'off' } }
);
const playToTheLoss = (l: ReturnType<typeof table>) => {
  l.manager.startGame('p1', l.gameId);
  for (let i = 0; i < 3; i += 1) {
    const state = l.room().gameState;
    l.manager.skip(state.players[state.currentPlayerIndex]!.id, { gameId: l.gameId });
  }
  expect(l.room().gameState.gamePhase).toBe('lost');
};

// Play Again: once a game has ended, any player still at the table deals the next round. The host's start from the lobby is
// unchanged.
describe('Play Again after a game has ended', () => {
  it('is refused while the game is still being played', () => {
    const l = table();
    l.manager.startGame('p1', l.gameId);
    expect(() => l.manager.playAgain('p2', l.gameId)).toThrow('Play Again is only after a game has ended');
  });

  it('lets a player who is not the host deal the next round at once', () => {
    const l = table();
    playToTheLoss(l);
    const next = l.manager.playAgain('p3', l.gameId);
    expect(next.gamePhase).toBe('playing');
    expect(next.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(next.players.every((p) => p.hand.length > 0)).toBe(true);
  });

  it('is not open to someone who is not at the table', () => {
    const l = table();
    playToTheLoss(l);
    expect(() => l.manager.playAgain('outsider', l.gameId)).toThrow('Only a player at this table can play again');
  });
});

// Why a seat cannot be taken back. A host's kick is said to be one; anything else is gone, so nobody is told they were removed
// when they were not.
describe('why a rejoin is refused', () => {
  const started = () => {
    const l = lobbyWithUsers([
      { id: 'p1', userId: 'u1', name: 'Ann' }, { id: 'p2', userId: 'u2', name: 'Ben' }, { id: 'p3', userId: 'u3', name: 'Cy' }
    ]);
    l.manager.startGame('p1', l.gameId);
    return l;
  };

  it('is kicked when the host removed the seat', () => {
    const l = started();
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(reasonOf(() => l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-new', token, 'u2'))).toBe('kicked');
  });

  it('is gone, not kicked, when the seat was already taken back from another device', () => {
    const l = started();
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-new', token, 'u2');
    expect(reasonOf(() => l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-again', token, 'u2'))).toBe('gone');
  });

  it('is gone for a wrong token, and for a game that is no longer kept', () => {
    const l = started();
    expect(reasonOf(() => l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-new', 'guess', 'u2'))).toBe('gone');
    expect(reasonOf(() => l.manager.rejoinPlayer('NOPE00', 'p2', 'p2-new', 'guess', 'u2'))).toBe('gone');
  });

  it('is live only for a kept seat whose token matches, and not once the host has removed it', () => {
    const l = started();
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    expect(l.manager.seatIsLive(l.gameId, 'p2', token)).toBe(true);
    expect(l.manager.seatIsLive(l.gameId, 'p2', 'guess')).toBe(false);
    l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(l.manager.seatIsLive(l.gameId, 'p2', token)).toBe(false);
  });
});
