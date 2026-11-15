import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';
import { lobbyWithUsers, rig } from './helpers/rig.js';

// Rules from the owner (14-Nov-2026): a dropped player is shown to the others after 10 seconds; after 90 seconds the host
// may kick them (or wait); if the host dropped, the next available player may kick the host and takes over as host; a kick
// in a live game counts as a quit for the one kicked.
const SEC = 1000;
const T0 = 1_000_000;
const started = (seats = 4) => {
  const l = lobbyWithUsers(Array.from({ length: seats }, (_, i) => ({ id: `p${i + 1}`, userId: `u${i + 1}`, name: `Name${i + 1}` })));
  l.manager.startGame('p1', l.gameId);
  return l;
};
const view = (l: ReturnType<typeof started>, viewer: string, atSec: number) => l.manager.reconnectionFor(l.gameId, viewer, T0 + atSec * SEC);
const kick = (l: ReturnType<typeof started>, by: string, target: string, atSec: number) =>
  l.manager.kickPlayer(by, { gameId: l.gameId, targetPlayerId: target }, T0 + atSec * SEC);

describe('what each player is told about a dropped player', () => {
  it('says nothing when everyone is connected', () => {
    const l = started();
    expect(view(l, 'p1', 500)).toBeUndefined();
  });

  it('says nothing for a blip shorter than 10 seconds, so a flicker never alarms the table', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    expect(view(l, 'p1', 9)).toBeUndefined();
  });

  it('tells everyone else from 10 seconds on, with the name, and the host cannot kick yet', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    for (const viewer of ['p1', 'p3', 'p4']) {
      expect(view(l, viewer, 10)).toEqual({ lost: [{ playerId: 'p2', name: 'Name2', status: 'reconnecting' }], canKick: [], canTakeOver: null });
    }
  });

  it('never tells a player about themselves', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    expect(view(l, 'p2', 60)).toBeUndefined();
  });

  it('offers the kick to the host alone from 90 seconds on', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    expect(view(l, 'p1', 90)).toEqual({ lost: [{ playerId: 'p2', name: 'Name2', status: 'lost' }], canKick: ['p2'], canTakeOver: null });
    expect(view(l, 'p3', 90)!.canKick).toEqual([]);
  });

  it('offers a lost host\'s seat to the next available player only', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    expect(view(l, 'p2', 89)!.canTakeOver).toBeNull();
    expect(view(l, 'p2', 90)!.canTakeOver).toBe('p1');
    expect(view(l, 'p3', 90)!.canTakeOver).toBeNull();
    expect(view(l, 'p4', 90)!.canTakeOver).toBeNull();
  });

  it('passes the offer along when the next player in seat order has dropped too', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    l.manager.markDisconnected('p2', T0);
    expect(view(l, 'p3', 90)!.canTakeOver).toBe('p1');
    expect(view(l, 'p4', 90)!.canTakeOver).toBeNull();
  });

  it('forgets a player who came back', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    const token = l.manager.getRejoinToken(l.gameId, 'p2');
    l.manager.rejoinPlayer(l.gameId, 'p2', 'p2-new', token);
    expect(view(l, 'p1', 300)).toBeUndefined();
  });

  it('does not hold the seat of a player who drops in the lobby', () => {
    const l = lobbyWithUsers([{ id: 'p1' }, { id: 'p2' }]);
    expect(l.manager.markDisconnected('p2', T0)).toEqual([]);
  });
});

describe('who may kick whom', () => {
  it('lets the host kick a connected player at once, and a dropped one only after 90 seconds', () => {
    const l = started();
    l.manager.markDisconnected('p2', T0);
    expect(() => kick(l, 'p1', 'p2', 30)).toThrow(/may still reconnect/);
    expect(kick(l, 'p1', 'p3', 30).players.map((p) => p.id)).toEqual(['p1', 'p2', 'p4']);
    expect(kick(l, 'p1', 'p2', 90).players.map((p) => p.id)).toEqual(['p1', 'p4']);
  });

  it('lets the next available player kick a host who has been gone 90 seconds, and makes them host', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    const after = kick(l, 'p2', 'p1', 90);
    expect(after.players.map((p) => p.id)).toEqual(['p2', 'p3', 'p4']);
    expect(after.hostId).toBe('p2');
    expect(after.players.map((p) => p.isHost)).toEqual([true, false, false]);
  });

  it('refuses that kick before 90 seconds, to a connected host, and to anyone but the next available player', () => {
    const l = started();
    expect(() => kick(l, 'p2', 'p1', 500)).toThrow(/Only host/);
    l.manager.markDisconnected('p1', T0);
    expect(() => kick(l, 'p2', 'p1', 89)).toThrow(/may still reconnect/);
    expect(() => kick(l, 'p3', 'p1', 90)).toThrow(/Only host/);
    expect(l.room().gameState.hostId).toBe('p1');
  });

  it('never lets a non-host kick anyone but a lost host', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    l.manager.markDisconnected('p3', T0);
    expect(() => kick(l, 'p2', 'p3', 90)).toThrow(/Only host/);
  });

  it('lets the new host carry on: the old host\'s seat is gone and a second kick works for them', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    kick(l, 'p2', 'p1', 90);
    expect(kick(l, 'p2', 'p4', 91).players.map((p) => p.id)).toEqual(['p2', 'p3']);
  });
});

describe('a kick in a live game is a quit for the one kicked', () => {
  it('records an abandoned game for the kicked player\'s account only', () => {
    const l = started();
    l.manager.markDisconnected('p3', T0);
    kick(l, 'p1', 'p3', 90);
    expect(l.rows().map((r) => [r.userId, r.outcome])).toEqual([['u3', 'abandoned']]);
  });

  it('records the same when the next player takes over from a lost host', () => {
    const l = started();
    l.manager.markDisconnected('p1', T0);
    kick(l, 'p2', 'p1', 90);
    expect(l.rows().map((r) => [r.userId, r.outcome])).toEqual([['u1', 'abandoned']]);
  });

  it('records nothing for a kick in the lobby', () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
    l.manager.kickPlayer('p1', { gameId: l.gameId, targetPlayerId: 'p2' });
    expect(l.rows()).toEqual([]);
  });

  it('does not call the game won just because hands are empty while the returned cards are still to be dealt', () => {
    const l = started(3);
    rig(l.room, (s) => {
      s.settings.autoRefillHand = true;
      s.drawPile = [];
      for (const p of s.players) p.hand = p.id === 'p3' ? [{ id: 'c-7', value: 7 }] : [];
      s.currentPlayerIndex = 0;
    });
    const after = kick(l, 'p1', 'p3', 0);
    expect(after.gamePhase).toBe('playing');
    expect(after.players.flatMap((p) => p.hand.map((c) => c.id))).toContain('c-7');
  });
});

// The same rules over the real socket protocol, with short times: the server must push each view at the right moment,
// and the kick must work from the view it sent.
describe('dropped connections over sockets', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  beforeEach(async () => {
    server = createRealtimeServer(0, undefined, { noticeMs: 40, kickMs: 150 });
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((x) => x.close());
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
  const latest = new Map<Socket, GameState>();
  const watch = (socket: Socket) => socket.on('game:updated', (state: GameState) => latest.set(socket, state));
  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(check()).toBe(true);
  };
  const table = async () => {
    const [a, b, c] = [await open(), await open(), await open()];
    const created = await ask(a, 'game:create', { playerName: 'Host', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(b, 'game:join', { gameId, playerName: 'Bee' });
    await ask(c, 'game:join', { gameId, playerName: 'Cee' });
    [a, b, c].forEach(watch);
    await ask(a, 'game:start', { gameId });
    return { a, b, c, gameId };
  };

  it('tells the table after the notice time and offers the host the kick after the kick time, then the kick works', async () => {
    const { a, b, c, gameId } = await table();
    const droppedId = b.id!;
    b.close();
    await until(() => latest.get(c)?.reconnection?.lost[0]?.status === 'reconnecting');
    expect(latest.get(a)!.reconnection!.canKick).toEqual([]);
    await until(() => latest.get(a)?.reconnection?.canKick.includes(droppedId) === true);
    expect(latest.get(c)!.reconnection!.canKick).toEqual([]);
    const kicked = await ask(a, 'game:kickPlayer', { gameId, targetPlayerId: droppedId });
    expect(kicked.ok).toBe(true);
    expect(kicked.data!.gameState.players.map((p) => p.id)).toEqual([a.id, c.id]);
  });

  it('offers a lost host\'s seat to the next player, who kicks the host and becomes host', async () => {
    const { a, b, c, gameId } = await table();
    const hostId = a.id!;
    a.close();
    await until(() => latest.get(b)?.reconnection?.canTakeOver === hostId);
    expect(latest.get(c)!.reconnection!.canTakeOver).toBeNull();
    const refused = await ask(c, 'game:kickPlayer', { gameId, targetPlayerId: hostId });
    expect(refused.ok).toBe(false);
    const taken = await ask(b, 'game:kickPlayer', { gameId, targetPlayerId: hostId });
    expect(taken.ok).toBe(true);
    expect(taken.data!.gameState.hostId).toBe(b.id);
  });

  it('shows nothing once the player has rejoined', async () => {
    const { a, b, c, gameId } = await table();
    const oldId = b.id!;
    const token = (server.manager as unknown as { getRejoinToken(g: string, p: string): string }).getRejoinToken(gameId, oldId);
    b.close();
    await until(() => latest.get(c)?.reconnection?.lost.length === 1);
    const b2 = await open();
    watch(b2);
    const back = await ask(b2, 'game:rejoin', { gameId, previousPlayerId: oldId, rejoinToken: token });
    expect(back.ok).toBe(true);
    await until(() => latest.get(a)?.reconnection === undefined && latest.get(c)?.reconnection === undefined);
  });
});
