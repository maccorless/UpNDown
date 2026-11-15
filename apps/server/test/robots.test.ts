import type { AddressInfo } from 'node:net';
import { chooseAction, observe } from '@upndown/engine';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { createRealtimeServer } from '../src/index.js';
import { lobbyWithUsers } from './helpers/rig.js';

const settings = { ...defaultMultiplayerSettings, maxPlayers: 4 };

// A robot is a seat the server plays. It counts toward the player limits, plays through the same rules as a person, and never
// takes anything a person is owed: not the host's seat, not an account's result, not a kick.
describe('robots at the table (rules)', () => {
  const table = () => {
    const l = lobbyWithUsers([{ id: 'h', userId: 'u-host', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    return l;
  };

  it('lets only the host add one, only in the lobby, and names them one after another', () => {
    const l = table();
    expect(() => l.manager.addRobot('g', l.gameId)).toThrow('Only host');
    const one = l.manager.addRobot('h', l.gameId);
    const two = l.manager.addRobot('h', l.gameId);
    expect(two.players.filter((p) => p.robot).map((p) => p.name)).toEqual(['Robot 1', 'Robot 2']);
    expect(one.players.find((p) => p.robot)).toMatchObject({ isHost: false, hand: [] });
    l.manager.startGame('h', l.gameId);
    expect(() => l.manager.addRobot('h', l.gameId)).toThrow('lobby');
  });

  it('counts robots toward the player limits, with no cap of their own', () => {
    const manager = new GameManager();
    const room = manager.createGame('h', { playerName: 'Hana', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    manager.addRobot('h', room.gameId);
    manager.addRobot('h', room.gameId);
    manager.addRobot('h', room.gameId);
    expect(() => manager.addRobot('h', room.gameId)).toThrow('full');
    expect(manager.peekState(room.gameId)!.players).toHaveLength(4);
    expect(manager.listJoinableGames()).toEqual([]); // a full table is not offered
  });

  it('removes a robot, and refuses to remove a person that way', () => {
    const l = table();
    const withBot = l.manager.addRobot('h', l.gameId);
    const botId = withBot.players.find((p) => p.robot)!.id;
    expect(() => l.manager.removeRobot('h', { gameId: l.gameId, playerId: 'g' })).toThrow('not a robot');
    expect(() => l.manager.removeRobot('g', { gameId: l.gameId, playerId: botId })).toThrow('Only host');
    expect(l.manager.removeRobot('h', { gameId: l.gameId, playerId: botId }).players.map((p) => p.id)).toEqual(['h', 'g']);
  });

  it('deals robots a hand and keeps their flag when the game starts, and lets a table of one person and one robot start', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }]);
    l.manager.addRobot('h', l.gameId);
    const started = l.manager.startGame('h', l.gameId);
    expect(started.players.map((p) => [p.robot === true, p.hand.length])).toEqual([[false, 7], [true, 7]]);
  });

  it('never hands the host seat to a robot, and removes a table that only robots would be left at', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    l.manager.addRobot('h', l.gameId);
    const afterHost = l.manager.leaveGame('h', l.gameId)!;
    expect(afterHost.hostId).toBe('g');
    expect(l.manager.leaveGame('g', l.gameId)).toBeNull();
    expect(l.manager.peekState(l.gameId)).toBeUndefined();
  });

  it('cannot be kicked from a game', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    const botId = l.manager.addRobot('h', l.gameId).players.find((p) => p.robot)!.id;
    l.manager.startGame('h', l.gameId);
    expect(() => l.manager.kickPlayer('h', { gameId: l.gameId, targetPlayerId: botId })).toThrow('cannot be kicked');
  });

  // A robot never disconnects, so a robot in the next seat would be offered the host's seat and no person could take it.
  it('is passed over when the host is lost: the next person, not the robot, may take over', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    l.manager.addRobot('h', l.gameId);
    // Seat order: Hana, Guy, Robot 1. Put the robot right after the host by removing and re-adding in a different order.
    l.manager.leaveGame('g', l.gameId);
    l.manager.addRobot('h', l.gameId);
    l.manager.joinGame('g2', { gameId: l.gameId, playerName: 'Gus' });
    l.manager.startGame('h', l.gameId);
    const order = l.room().gameState.players.map((p) => p.robot ? 'robot' : p.id);
    expect(order.slice(0, 2)).toEqual(['h', 'robot']);
    l.manager.markDisconnected('h', 1_000);
    expect(l.manager.reconnectionFor(l.gameId, 'g2', 1_000 + 90_000)?.canTakeOver).toBe('h');
    expect(l.manager.kickPlayer('g2', { gameId: l.gameId, targetPlayerId: 'h' }, 1_000 + 90_000).hostId).toBe('g2');
  });

  it('records a result only for signed-in people, and still counts the robots as players', () => {
    const l = lobbyWithUsers([{ id: 'h', userId: 'u-host', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    l.manager.addRobot('h', l.gameId);
    l.manager.startGame('h', l.gameId);
    l.manager.endGame('h', l.gameId);
    const rows = l.rows();
    expect(rows.map((r) => r.userId)).toEqual(['u-host']);
    expect(rows[0]!.playerCount).toBe(3);
  });

  it('saves and restores a robot as a robot, never as someone who dropped', () => {
    const l = lobbyWithUsers([{ id: 'h', userId: 'u1', name: 'Hana' }]);
    l.manager.addRobot('h', l.gameId);
    l.manager.startGame('h', l.gameId);
    const stored = l.manager.exportRoom(l.gameId)!;
    const fresh = new GameManager();
    fresh.importRoom(stored, 5_000);
    expect(fresh.peekState(l.gameId)!.players.find((p) => p.robot)).toBeDefined();
    expect(fresh.reconnectionFor(l.gameId, 'someone', 5_000 + 20_000)?.lost.map((x) => x.name)).toEqual(['Hana']);
  });
});

describe('when robots may act', () => {
  const playing = (humans: number) => {
    const l = lobbyWithUsers(Array.from({ length: humans }, (_, i) => ({ id: `h${i + 1}`, userId: `u${i + 1}`, name: `Person ${i + 1}` })));
    l.manager.addRobot('h1', l.gameId);
    l.manager.startGame('h1', l.gameId);
    return l;
  };
  const robotsTurn = (l: ReturnType<typeof playing>) => {
    const state = l.room().gameState;
    l.room().gameState = { ...state, currentPlayerIndex: state.players.findIndex((p) => p.robot) };
  };

  it('acts on its own turn, once a person is at the table, and not on a person\'s turn', () => {
    const l = playing(1);
    expect(l.manager.robotToAct(l.gameId)).toBeNull(); // the person is first
    robotsTurn(l);
    expect(l.manager.robotToAct(l.gameId)).not.toBeNull();
  });

  it('waits while every person is away, and goes on when one is back', () => {
    const l = playing(1);
    robotsTurn(l);
    l.manager.markDisconnected('h1', 1_000);
    expect(l.manager.robotToAct(l.gameId)).toBeNull();
    const token = l.manager.getRejoinToken(l.gameId, 'h1');
    l.manager.rejoinPlayer(l.gameId, 'h1', 'h1-new', token);
    expect(l.manager.robotToAct(l.gameId)).not.toBeNull();
  });

  it('ignores a step planned for a moment that has passed', () => {
    const l = playing(1);
    robotsTurn(l);
    const due = l.manager.robotToAct(l.gameId)!;
    expect(l.manager.robotStep(l.gameId, `${due.turnKey}-stale`)).toBeNull();
    const done = l.manager.robotStep(l.gameId, due.turnKey);
    expect(done?.robotId).toBe(due.robotId);
    // The same plan cannot be run twice: the moment it named is gone.
    expect(l.manager.robotStep(l.gameId, due.turnKey)).toBeNull();
  });

  it('plays only moves the rules allow, through the same checks as a person', () => {
    const l = playing(1);
    robotsTurn(l);
    for (let i = 0; i < 6; i += 1) {
      const due = l.manager.robotToAct(l.gameId);
      if (!due) break;
      expect(() => l.manager.robotStep(l.gameId, due.turnKey)).not.toThrow();
    }
    expect(l.room().gameState.statistics.players[l.room().gameState.players.find((p) => p.robot)!.id]!.cardsPlayed).toBeGreaterThan(0);
  });

  it('ends a game with robots and nobody left after the kick time, as abandoned for each signed-in person', () => {
    const l = playing(2);
    l.manager.markDisconnected('h1', 1_000);
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, 1_000 + 95_000)).toBe(false); // h2 is still here
    l.manager.markDisconnected('h2', 2_000);
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, 2_000 + 89_000)).toBe(false); // not long enough
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, 2_000 + 91_000)).toBe(true);
    expect(l.manager.peekState(l.gameId)).toBeUndefined();
    expect(l.rows().map((r) => [r.userId, r.outcome]).sort()).toEqual([['u1', 'abandoned'], ['u2', 'abandoned']]);
  });

  it('leaves a game with no robots alone, however long its people are away, so a restart can still be recovered', () => {
    const l = lobbyWithUsers([{ id: 'h1', userId: 'u1', name: 'Hana' }, { id: 'h2', name: 'Guy' }]);
    l.manager.startGame('h1', l.gameId);
    l.manager.markDisconnected('h1', 1_000);
    l.manager.markDisconnected('h2', 1_000);
    expect(l.manager.abandonIfOnlyRobotsRemain(l.gameId, 1_000 + 10_000_000)).toBe(false);
  });
});

// The whole thing over real sockets: a person and robots play a game to its end.
describe('a game with robots over sockets', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  const boot = async (timing: { robotDelayMs?: number; kickMs?: number; noticeMs?: number } = { robotDelayMs: 2 }) => {
    server = createRealtimeServer(0, undefined, timing);
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  };
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await server.stop().catch(() => undefined);
  });
  const open = (): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
  type Ack = { ok: boolean; data?: { gameState: GameState }; error?: string };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

  it('lets the host add and remove robots, and the robots play their turns to the end of the game', async () => {
    await boot();
    const host = await open();
    const created = await ask(host, 'game:create', { playerName: 'Hana', settings: { ...settings, minCardValue: 2, maxCardValue: 40, handSize: 6, minCardsPerTurn: 1 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    const guestlessAdd = await ask(host, 'game:addRobot', { gameId });
    expect(guestlessAdd.data!.gameState.players.map((p) => p.name)).toEqual(['Hana', 'Robot 1']);
    const extra = await ask(host, 'game:addRobot', { gameId });
    const botId = extra.data!.gameState.players.find((p) => p.name === 'Robot 2')!.id;
    expect((await ask(host, 'game:removeRobot', { gameId, playerId: botId })).data!.gameState.players).toHaveLength(2);
    await ask(host, 'game:addRobot', { gameId });

    let latest: GameState | undefined;
    host.on('game:updated', (state: GameState) => { latest = state; });
    const started = await ask(host, 'game:start', { gameId });
    latest = started.data!.gameState;
    let robotMoves = 0;
    const seenTurns = new Set<string>();
    host.on('game:updated', (state: GameState) => {
      const current = state.players[state.currentPlayerIndex];
      if (current?.robot) seenTurns.add(`${state.statistics.turns}:${current.name}`);
    });
    // The person plays by the same advice a hint gives; the robots play themselves.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && latest && latest.gamePhase === 'playing') {
      const state: GameState = latest;
      const mine = state.players[state.currentPlayerIndex]!.id === host.id;
      if (mine) {
        const action = chooseAction(observe(state, host.id!));
        if (action.type === 'play') await ask(host, 'game:playCard', { gameId, cardId: action.cardId, pileId: action.pileId });
        else if (action.type === 'endTurn') await ask(host, 'game:endTurn', { gameId });
        else break;
      } else {
        robotMoves += 1;
        await wait(4);
      }
    }
    expect(latest!.gamePhase === 'won' || latest!.gamePhase === 'lost').toBe(true);
    expect(seenTurns.size).toBeGreaterThan(0); // the robots really took turns
    expect(robotMoves).toBeGreaterThan(0);
  }, 30_000);

  it('stops when nobody is left to watch, and ends the game after the kick time', async () => {
    await boot({ robotDelayMs: 2, noticeMs: 20, kickMs: 120 });
    const host = await open();
    const created = await ask(host, 'game:create', { playerName: 'Hana', settings, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(host, 'game:addRobot', { gameId });
    await ask(host, 'game:start', { gameId });
    host.close();
    await wait(60);
    const frozen = JSON.stringify(server.manager.peekState(gameId)!.statistics);
    await wait(60);
    expect(JSON.stringify(server.manager.peekState(gameId)!.statistics)).toBe(frozen); // robots wait for a person
    await wait(250);
    expect(server.manager.peekState(gameId)).toBeUndefined(); // and the game is over
  });

  it('refuses robots to anyone but the host, and a seat that is not a robot', async () => {
    await boot();
    const host = await open();
    const guest = await open();
    const created = await ask(host, 'game:create', { playerName: 'Hana', settings, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(guest, 'game:join', { gameId, playerName: 'Guy' });
    expect((await ask(guest, 'game:addRobot', { gameId })).ok).toBe(false);
    expect((await ask(host, 'game:removeRobot', { gameId, playerId: guest.id })).ok).toBe(false);
  });
});
