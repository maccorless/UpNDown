import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState, type JoinRequestEvent, type JoinResolvedEvent } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';
import { lobbyWithUsers, rig } from './helpers/rig.js';

// Joining a game already being played, by invitation, with the host's say. Nothing is taken from the game until the host
// agrees, and when they do, every other hand and every pile stays exactly as it was.
describe('late join (rules)', () => {
  const live = () => {
    const l = lobbyWithUsers([{ id: 'h', userId: 'u-host', name: 'Hana' }, { id: 'g', name: 'Guy' }]);
    l.manager.startGame('h', l.gameId);
    return l;
  };
  const invited = (l: ReturnType<typeof live>) => l.manager.createInvite('h', l.gameId).token;
  const ask = (l: ReturnType<typeof live>, token: string, socketId = 'n1', name = 'Nia', userId?: string) =>
    l.manager.requestJoin(socketId, { gameId: l.gameId, inviteToken: token, playerName: name }, userId);

  it('lets only the host make an invitation, and only for a game being played', () => {
    const l = live();
    expect(() => l.manager.createInvite('g', l.gameId)).toThrow('Only host');
    const lobby = lobbyWithUsers([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(() => lobby.manager.createInvite('a', lobby.gameId)).toThrow('being played');
    const one = l.manager.createInvite('h', l.gameId);
    const two = l.manager.createInvite('h', l.gameId);
    expect(one.token).not.toBe(two.token);
    expect(one.token.length).toBeGreaterThanOrEqual(24);
  });

  it('answers every bad invitation the same way, so nobody can use it to find games', () => {
    const l = live();
    const token = invited(l);
    const message = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
    const wrongToken = message(() => ask(l, 'x'.repeat(30)));
    const wrongGame = message(() => l.manager.requestJoin('n1', { gameId: 'ZZZZZZ', inviteToken: token, playerName: 'Nia' }));
    const lobby = lobbyWithUsers([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const lobbyGame = message(() => lobby.manager.requestJoin('n1', { gameId: lobby.gameId, inviteToken: token, playerName: 'Nia' }));
    expect(wrongToken).toBe(wrongGame);
    expect(wrongToken).toBe(lobbyGame);
    expect(wrongToken).toContain('not available');
  });

  it('refuses an expired invitation', () => {
    const l = live();
    const { token, expiresAtMs } = l.manager.createInvite('h', l.gameId, 1_000);
    expect(() => l.manager.requestJoin('n1', { gameId: l.gameId, inviteToken: token, playerName: 'Nia' }, undefined, expiresAtMs + 1)).toThrow('not available');
  });

  it('takes nothing from the game when someone merely asks', () => {
    const l = live();
    const before = structuredClone(l.room().gameState);
    ask(l, invited(l));
    expect(l.room().gameState).toEqual(before);
  });

  it('refuses a second request on the same invitation while one is waiting, a seated connection, and an account already in the game', () => {
    const l = live();
    const token = invited(l);
    ask(l, token);
    expect(() => ask(l, token, 'n2', 'Other')).toThrow('already asking');
    expect(() => l.manager.requestJoin('g', { gameId: l.gameId, inviteToken: invited(l), playerName: 'Guy' })).toThrow('already in a game');
    expect(() => ask(l, invited(l), 'n3', 'Hana again', 'u-host')).toThrow('already in this game');
  });

  it('deals the new player in from the bottom of the pile and changes nothing else', () => {
    const l = live();
    const before = structuredClone(l.room().gameState);
    const request = ask(l, invited(l), 'n1', 'Nia', 'u-nia');
    const result = l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true });
    const after = result.state!;
    const n = before.settings.handSize;
    expect(after.players).toHaveLength(before.players.length + 1);
    // Every existing hand and pile is exactly as it was.
    expect(after.players.slice(0, before.players.length).map((p) => p.hand)).toEqual(before.players.map((p) => p.hand));
    expect(after.foundationPiles).toEqual(before.foundationPiles);
    expect(after.currentPlayerIndex).toBe(before.currentPlayerIndex);
    expect(after.cardsPlayedThisTurn).toBe(before.cardsPlayedThisTurn);
    // The newcomer's cards are the last ones of the draw pile, so what the active player draws next is undisturbed.
    expect(after.players.at(-1)!.hand.map((c) => c.id)).toEqual(before.drawPile.slice(-n).map((c) => c.id));
    expect(after.drawPile.map((c) => c.id)).toEqual(before.drawPile.slice(0, -n).map((c) => c.id));
    expect(after.players.at(-1)).toMatchObject({ id: 'n1', name: 'Nia', isHost: false });
    expect(after.statistics.players.n1).toBeDefined();
  });

  it('gives the newcomer a credential and their account, and uses the invitation up', () => {
    const l = live();
    const token = invited(l);
    const request = ask(l, token, 'n1', 'Nia', 'u-nia');
    l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true });
    expect(l.manager.getRejoinToken(l.gameId, 'n1')).toBeTruthy();
    expect(l.manager.heldGamesByAccount('u-nia')).toEqual([l.gameId]);
    expect(() => ask(l, token, 'n2', 'Late')).toThrow('not available'); // single use
  });

  it('gives only the cards that are left when the pile is short, and nothing when it is empty', () => {
    const l = live();
    rig(l.room, (s) => { s.drawPile = s.drawPile.slice(0, 3); });
    const request = ask(l, invited(l));
    expect(l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true }).state!.players.at(-1)!.hand).toHaveLength(3);
    const l2 = live();
    rig(l2.room, (s) => { s.drawPile = []; });
    const r2 = ask(l2, invited(l2));
    expect(() => l2.manager.resolveJoin('h', { gameId: l2.gameId, requestId: r2.requestId, approve: true })).toThrow('no cards left');
    expect(l2.room().gameState.players).toHaveLength(2);
  });

  it('refuses a host who is not the host, answers a decline without touching the game, and drops a request nobody answers', () => {
    const l = live();
    const request = ask(l, invited(l));
    expect(() => l.manager.resolveJoin('g', { gameId: l.gameId, requestId: request.requestId, approve: true })).toThrow('Only host');
    const before = structuredClone(l.room().gameState);
    expect(l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: false }).state).toBeUndefined();
    expect(l.room().gameState).toEqual(before);
    expect(() => l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true })).toThrow('no longer waiting');
    const second = ask(l, invited(l), 'n2', 'Nia');
    expect(l.manager.dropJoinRequest(l.gameId, second.requestId)).not.toBeNull();
    expect(l.manager.pendingJoinRequests(l.gameId)).toEqual([]);
  });

  it('re-checks when the host answers: a full table, a game that ended, and an expired invitation', () => {
    const full = live();
    rig(full.room, (s) => { s.settings = { ...s.settings, maxPlayers: 2 }; });
    expect(() => ask(full, invited(full))).toThrow('not available');

    const late = live();
    const request = ask(late, invited(late));
    rig(late.room, (s) => { s.gamePhase = 'won'; });
    expect(() => late.manager.resolveJoin('h', { gameId: late.gameId, requestId: request.requestId, approve: true })).toThrow('no longer being played');

    const stale = live();
    const { token } = stale.manager.createInvite('h', stale.gameId, 1_000);
    const req = stale.manager.requestJoin('n1', { gameId: stale.gameId, inviteToken: token, playerName: 'Nia' }, undefined, 2_000);
    expect(() => stale.manager.resolveJoin('h', { gameId: stale.gameId, requestId: req.requestId, approve: true }, 1_000 + 31 * 60 * 1000)).toThrow('expired');
  });

  // An admission must never be what ends a game. If dealing would leave the game lost, it is refused and nothing changes.
  it('refuses an admission that would end the game, and leaves the game and the invitation as they were', () => {
    const l = live();
    rig(l.room, (s) => {
      s.settings = { ...s.settings, autoRefillHand: true };
      s.currentPlayerIndex = 0;
      s.cardsPlayedThisTurn = 0;
      s.players[0]!.hand = [{ id: 'c-60', value: 60 }];
      s.foundationPiles = [
        { id: 0, type: 'ascending', topCard: { id: 'f0', value: 90 } },
        { id: 1, type: 'ascending', topCard: { id: 'f1', value: 90 } },
        { id: 2, type: 'descending', topCard: { id: 'f2', value: 20 } },
        { id: 3, type: 'descending', topCard: { id: 'f3', value: 20 } }
      ];
    });
    const before = structuredClone(l.room().gameState);
    const token = invited(l);
    const request = ask(l, token);
    expect(() => l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true })).toThrow('would end this game');
    expect(l.room().gameState).toEqual(before);
    expect(l.manager.pendingJoinRequests(l.gameId)).toHaveLength(1); // still waiting, and the invitation still works
  });

  it('is a barrier for undo, and keeps what an account used before it was removed', () => {
    const l = lobbyWithUsers([{ id: 'h', userId: 'u1', name: 'Hana' }, { id: 'g', userId: 'u2', name: 'Guy' }, { id: 'k', userId: 'u3', name: 'Kai' }]);
    l.manager.startGame('h', l.gameId);
    rig(l.room, (s) => { s.settings = { ...s.settings, allowUndo: true, cheatLimits: { lookup: 'once', skip: 'off', trade: 'off', hint: 'off' } }; });
    const asker = l.room().gameState.players.find((p) => p.id === 'k')!;
    l.manager.lookupCardStatus(l.gameId, 'k', asker.hand[0]!.value); // Kai uses their one lookup
    l.manager.kickPlayer('h', { gameId: l.gameId, targetPlayerId: 'k' });
    const request = l.manager.requestJoin('k2', { gameId: l.gameId, inviteToken: l.manager.createInvite('h', l.gameId).token, playerName: 'Kai' }, 'u3');
    l.manager.resolveJoin('h', { gameId: l.gameId, requestId: request.requestId, approve: true });
    // Let back in, Kai's single lookup is still spent.
    expect(() => l.manager.lookupCardStatus(l.gameId, 'k2', 50)).toThrow('already used');
    expect(l.room().turnUndoStack).toEqual([]);
  });
});

describe('late join over sockets', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  const boot = async (timing: { joinRequestTtlMs?: number } = {}) => {
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
  type Ack = { ok: boolean; data?: Record<string, unknown> & { gameState?: GameState; token?: string; requestId?: string }; error?: string };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
  const next = <T,>(socket: Socket, event: string): Promise<T> => new Promise((resolve) => { socket.once(event, resolve); });

  async function game() {
    const [host, guest] = [await open(), await open()];
    const created = await ask(host, 'game:create', { playerName: 'Hana', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState!.gameId;
    await ask(guest, 'game:join', { gameId, playerName: 'Guy' });
    await ask(host, 'game:start', { gameId });
    const invite = await ask(host, 'game:createInvite', { gameId });
    return { host, guest, gameId, token: invite.data!.token! };
  }

  it('asks the host, deals the newcomer in on a yes, shows the others the new table, and keeps hands hidden', async () => {
    await boot();
    const { host, guest, gameId, token } = await game();
    const before = server.manager.peekState(gameId)!;
    const hostUpdate = next<GameState>(host, 'game:updated');
    const guestUpdate = next<GameState>(guest, 'game:updated');
    const request = next<JoinRequestEvent>(host, 'game:joinRequest');
    const newcomer = await open();
    const resolved = next<JoinResolvedEvent>(newcomer, 'game:joinResolved');
    const asked = await ask(newcomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Nia' });
    expect(asked.ok).toBe(true);
    const seen = await request;
    expect(seen.playerName).toBe('Nia');
    expect((await ask(host, 'game:resolveJoin', { gameId, requestId: seen.requestId, approve: true })).ok).toBe(true);

    const answer = await resolved;
    expect(answer.approved).toBe(true);
    if (!answer.approved) return;
    const mine = answer.gameState.players.find((p) => p.id === answer.playerId)!;
    expect(mine.hand.length).toBeGreaterThan(0);
    expect(mine.hand.every((c) => c.value > 0)).toBe(true); // their own cards are shown to them
    expect(answer.rejoinToken).toBeTruthy();
    for (const view of [await hostUpdate, await guestUpdate]) {
      expect(view.players.map((p) => p.name)).toEqual(['Hana', 'Guy', 'Nia']);
      const theirs = view.players.find((p) => p.name === 'Nia')!;
      expect(theirs.hand.every((c) => c.value === 0)).toBe(true); // everyone else's cards stay hidden
    }
    expect(server.manager.peekState(gameId)!.players.slice(0, 2).map((p) => p.hand)).toEqual(before.players.map((p) => p.hand));
    // The invitation is used up.
    const latecomer = await open();
    expect((await ask(latecomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Too late' })).ok).toBe(false);
  });

  it('tells the person when the host says no, and does not touch the game', async () => {
    await boot();
    const { host, gameId, token } = await game();
    const request = next<JoinRequestEvent>(host, 'game:joinRequest');
    const newcomer = await open();
    const resolved = next<JoinResolvedEvent>(newcomer, 'game:joinResolved');
    await ask(newcomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Nia' });
    await ask(host, 'game:resolveJoin', { gameId, requestId: (await request).requestId, approve: false });
    expect(await resolved).toEqual({ approved: false, reason: 'The host said no.' });
    expect(server.manager.peekState(gameId)!.players).toHaveLength(2);
  });

  it('refuses anyone but the host an answer, and an invitation to anyone but the host', async () => {
    await boot();
    const { host, guest, gameId, token } = await game();
    expect((await ask(guest, 'game:createInvite', { gameId })).ok).toBe(false);
    const request = next<JoinRequestEvent>(host, 'game:joinRequest');
    const newcomer = await open();
    await ask(newcomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Nia' });
    expect((await ask(guest, 'game:resolveJoin', { gameId, requestId: (await request).requestId, approve: true })).ok).toBe(false);
    expect(server.manager.peekState(gameId)!.players).toHaveLength(2);
  });

  it('does not leave the person waiting for ever when the host does not answer', async () => {
    await boot({ joinRequestTtlMs: 60 });
    const { host, gameId, token } = await game();
    const cancelled = next<{ requestId: string }>(host, 'game:joinRequestCancelled');
    const newcomer = await open();
    const resolved = next<JoinResolvedEvent>(newcomer, 'game:joinResolved');
    await ask(newcomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Nia' });
    expect(await resolved).toEqual({ approved: false, reason: 'The host did not answer in time.' });
    expect((await cancelled).requestId).toBeTruthy();
  });

  it('tells the host when the person gives up and goes away', async () => {
    await boot();
    const { host, gameId, token } = await game();
    const cancelled = next<{ requestId: string }>(host, 'game:joinRequestCancelled');
    const newcomer = await open();
    await ask(newcomer, 'game:requestJoin', { gameId, inviteToken: token, playerName: 'Nia' });
    newcomer.close();
    expect((await cancelled).requestId).toBeTruthy();
    await wait(20);
    expect(server.manager.pendingJoinRequests(gameId)).toEqual([]);
  });
});
