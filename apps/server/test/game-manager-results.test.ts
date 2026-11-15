import { describe, expect, it } from 'vitest';
import { GameManager, defaultMultiplayerSettings } from '../src/game-manager.js';
import { lobbyWithUsers, rig, setUpLoss, setUpWin } from './helpers/rig.js';

const three = () => lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }, { id: 'p3' }]); // p3 is a guest

function win(l: ReturnType<typeof three>, activeId = 'p1') {
  rig(l.room, (s) => setUpWin(s, activeId));
  return l.manager.playCard(activeId, { gameId: l.gameId, cardId: 'c-2', pileId: 0 });
}

describe('recording a finished game', () => {
  it('records a win for each signed-in player and not for a guest, with the player\'s own counters', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    const finished = win(l);
    expect(finished.gamePhase).toBe('won');
    const rows = l.rows();
    expect(rows.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    expect(rows.every((r) => r.outcome === 'won' && r.mode === 'multiplayer' && r.playerCount === 3 && r.cardsLeft === 0)).toBe(true);
    const mine = rows.find((r) => r.userId === 'u1')!;
    // The winning play: card 2 onto the ascending pile that starts at 1.
    expect(mine).toMatchObject({ myCardsPlayed: 1, myTotalMovement: 1, mySpecialPlays: 0 });
    expect(rows.find((r) => r.userId === 'u2')).toMatchObject({ myCardsPlayed: 0, myTotalMovement: 0 });
  });

  it('records a loss when ending a turn leaves the next player with no legal move', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    rig(l.room, (s) => setUpLoss(s, 'p1'));
    const after = l.manager.endTurn('p1', l.gameId);
    expect(after.gamePhase).toBe('lost');
    expect(l.rows().map((r) => r.outcome)).toEqual(['lost', 'lost']);
    expect(l.rows()[0]!.cardsLeft).toBe(3);
  });

  it('keys every row of one game on one run id, which is not the room code', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    win(l);
    const ids = new Set(l.rows().map((r) => r.gameId));
    expect(ids.size).toBe(1);
    expect(ids.has(l.gameId)).toBe(false);
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  // The host returns a finished room to the lobby and starts again under the same code. Those are two games.
  it('makes two rows per player over two games in one room, each under its own run id', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    win(l);
    l.manager.endGame('p1', l.gameId);
    l.manager.startGame('p1', l.gameId);
    win(l, 'p2');
    const rows = l.rows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.gameId)).size).toBe(2);
    expect(rows.filter((r) => r.userId === 'u1')).toHaveLength(2);
  });

  it('records nothing for a guest-only game, and nothing for a game that is not finished', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    l.manager.startGame('p1', l.gameId);
    expect(l.batches).toHaveLength(0);
    win(l);
    expect(l.batches).toHaveLength(0);
  });

  it('does not record a game that is merely played: a card played, a turn ended', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    rig(l.room, (s) => { s.cardsPlayedThisTurn = 0; });
    expect(l.rows()).toHaveLength(0);
  });
});

describe('a finished result is written once', () => {
  it('records nothing when the finished room is returned to the lobby, or when someone rejoins it', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    win(l);
    expect(l.batches).toHaveLength(1);
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2b', token, 'u2');
    expect(l.batches).toHaveLength(1);
    l.manager.endGame('p1', l.gameId);
    expect(l.batches).toHaveLength(1);
  });

  it('cannot finish twice: playing into a finished game is refused and records nothing more', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    win(l);
    expect(() => l.manager.playCard('p1', { gameId: l.gameId, cardId: 'c-2', pileId: 0 })).toThrow();
    expect(() => l.manager.endTurn('p1', l.gameId)).toThrow();
    expect(l.batches).toHaveLength(1);
  });

  it('a kick after the end is refused, so it cannot disturb the recorded result', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    win(l);
    expect(() => l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' })).toThrow();
    expect(l.batches).toHaveLength(1);
  });
});

describe('quitting a started game', () => {
  it('records an abandoned row for the host alone, with the progress so far', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    rig(l.room, (s) => {
      s.statistics.turns = 4;
      s.statistics.players.p1 = { cardsPlayed: 9, totalMovement: 40, specialPlays: 1, nasCheatsUsed: 0 };
      s.statistics.players.p2 = { cardsPlayed: 7, totalMovement: 30, specialPlays: 0, nasCheatsUsed: 0 };
    });
    l.manager.endGame('p1', l.gameId);
    const rows = l.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u1', outcome: 'abandoned', turns: 4, myCardsPlayed: 9, myTotalMovement: 40, playerCount: 3 });
    expect(rows[0]!.cardsLeft).toBeGreaterThan(0);
    expect(rows[0]!.endedAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.startedAt.getTime());
  });

  it('records nothing when the host is a guest, even if the others are signed in', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.startGame('p1', l.gameId);
    l.manager.endGame('p1', l.gameId);
    expect(l.rows()).toHaveLength(0);
  });

  it('records nothing for a lobby that never started, and ending it is refused', () => {
    const l = three();
    expect(() => l.manager.endGame('p1', l.gameId)).toThrow('Game is already in lobby');
    expect(l.rows()).toHaveLength(0);
  });

  it('only the host can end a game, so a non-host cannot make an abandoned row for anyone', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    expect(() => l.manager.endGame('p2', l.gameId)).toThrow('Only host can end game');
    expect(l.rows()).toHaveLength(0);
  });

  it('after an abandoned game the room starts a fresh run, so the next result is a different game', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.endGame('p1', l.gameId);
    l.manager.startGame('p1', l.gameId);
    win(l);
    const ids = l.rows().map((r) => r.gameId);
    expect(new Set(ids).size).toBe(2);
    expect(l.rows().map((r) => r.outcome)).toEqual(['abandoned', 'won', 'won']);
  });
});

describe('whose result it is', () => {
  it('credits the account that took the seat, not one that rejoins it', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    // p2's connection drops and comes back as a different signed-in account (a second person on the same device).
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2b', l.manager.getRejoinToken(l.gameId, 'p2'), 'u-intruder');
    win(l);
    expect(l.rows().map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('keeps the seat\'s account when it rejoins signed out', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2b', l.manager.getRejoinToken(l.gameId, 'p2'));
    win(l);
    expect(l.rows().map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('lets a seat taken as a guest take the account that comes back signed in', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.rejoinPlayer(l.gameId, 'p3', 'p3b', l.manager.getRejoinToken(l.gameId, 'p3'), 'u3');
    win(l);
    expect(l.rows().map((r) => r.userId).sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('keeps crediting a seat through two reconnects in a row', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2b', l.manager.getRejoinToken(l.gameId, 'p2'), 'u2');
    l.manager.rejoinPlayer(l.gameId, 'p2b', 'p2c', l.manager.getRejoinToken(l.gameId, 'p2b'));
    win(l);
    expect(l.rows().map((r) => r.userId)).toContain('u2');
  });

  // The host dropped and a signed-in stranger cannot become the host's abandoned row either.
  it('credits an abandoned row to the account that hosted, after the host reconnects', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.rejoinPlayer(l.gameId, 'p1', 'p1b', l.manager.getRejoinToken(l.gameId, 'p1'));
    l.manager.endGame('p1b', l.gameId);
    expect(l.rows().map((r) => r.userId)).toEqual(['u1']);
  });

  // A kick in a live game is a quit for the one kicked (an abandoned row), while the rest still get the team result.
  it('records a kicked player as having abandoned, and the others their result', () => {
    const l = three();
    l.manager.startGame('p1', l.gameId);
    l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    win(l);
    expect(l.rows().map((r) => [r.userId, r.outcome])).toEqual([['u2', 'abandoned'], ['u1', 'won']]);
    expect(l.rows()[1]!.playerCount).toBe(2);
  });

  it('forgets a player who leaves the lobby, so a new player on that socket id gets no credit', () => {
    const l = three();
    l.manager.leaveGame('p2', l.gameId);
    l.manager.joinGame('p2', { gameId: l.gameId, playerName: 'Guest again' });
    l.manager.startGame('p1', l.gameId);
    win(l);
    expect(l.rows().map((r) => r.userId)).toEqual(['u1']);
  });
});

describe('recording never breaks play', () => {
  it('finishes the game even when the recording hook throws', () => {
    const manager = new GameManager({ onResults: () => { throw new Error('database on fire'); } });
    const created = manager.createGame('p1', { playerName: 'A', settings: { ...defaultMultiplayerSettings, maxPlayers: 6 }, isSolitaire: false }, 'u1');
    manager.joinGame('p2', { gameId: created.gameId, playerName: 'B' }, 'u2');
    manager.startGame('p1', created.gameId);
    const room = (manager as unknown as { rooms: Map<string, { gameState: import('@upndown/shared-types').GameState }> }).rooms.get(created.gameId)!;
    const state = structuredClone(room.gameState);
    setUpWin(state, 'p1');
    room.gameState = state;
    expect(manager.playCard('p1', { gameId: created.gameId, cardId: 'c-2', pileId: 0 }).gamePhase).toBe('won');
  });

  it('works with no hook at all', () => {
    const manager = new GameManager();
    const created = manager.createGame('p1', { playerName: 'A', settings: { ...defaultMultiplayerSettings, maxPlayers: 6 }, isSolitaire: false });
    expect(created.players).toHaveLength(1);
  });
});
