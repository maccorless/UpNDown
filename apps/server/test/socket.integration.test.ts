import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, Socket } from 'socket.io-client';
import { createRealtimeServer } from '../src/index.js';

interface AckSuccess<T> {
  ok: true;
  data: T;
}

interface AckFailure {
  ok: false;
  error: string;
}

type Ack<T> = AckSuccess<T> | AckFailure;

describe('socket integration', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let url = '';

  beforeEach(async () => {
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const address = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  function connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(url, { transports: ['websocket'] });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  it('survives a non-function ack argument (otherwise one socket can crash the process and wipe all games)', async () => {
    const attacker = await connect();
    attacker.emit('game:leave', {}, 'x');
    attacker.emit('game:create', 'garbage', 'x');
    attacker.emit('game:listJoinable', null, 'x');

    const other = await connect();
    const response = await new Promise<Ack<{ games: unknown[] }>>((resolve) => {
      other.emit('game:listJoinable', {}, (ack: Ack<{ games: unknown[] }>) => resolve(ack));
    });
    expect(response.ok).toBe(true);

    attacker.disconnect();
    other.disconnect();
  });

  describe('rejoin ownership', () => {
    type Seat = { gameState: { gameId: string; hostId: string }; playerId: string; rejoinToken: string };

    const emitAck = <T>(socket: Socket, event: string, payload: unknown) =>
      new Promise<Ack<T>>((resolve) => socket.emit(event, payload, (ack: Ack<T>) => resolve(ack)));

    async function hostWithGuest() {
      const host = await connect();
      const created = await emitAck<Seat>(host, 'game:create', {
        playerName: 'Host',
        isSolitaire: false,
        settings: {
          minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
          autoRefillHand: false, allowUndo: false, privateGame: false, allowCardLookup: false, showArrows: true
        }
      });
      if (!created.ok) throw new Error('create failed');
      return { host, hostSeat: created.data, gameId: created.data.gameState.gameId };
    }

    it('rejects a takeover that knows the host id but not the rejoin token (otherwise any lobby member could steal the host seat)', async () => {
      const { host, hostSeat, gameId } = await hostWithGuest();
      const stranger = await connect();

      const noToken = await emitAck(stranger, 'game:rejoin', { gameId, previousPlayerId: hostSeat.playerId });
      const wrongToken = await emitAck(stranger, 'game:rejoin', {
        gameId, previousPlayerId: hostSeat.playerId, rejoinToken: 'not-the-token'
      });

      expect(noToken.ok).toBe(false);
      expect(wrongToken.ok).toBe(false);
      const joined = await emitAck<Seat>(stranger, 'game:join', { gameId, playerName: 'Guest' });
      expect(joined.ok).toBe(true);
      if (joined.ok) expect(joined.data.gameState.hostId).toBe(hostSeat.playerId);

      host.disconnect();
      stranger.disconnect();
    });

    it('lets the real player rejoin with the token, keeps host, and rotates the token so the old one cannot be replayed', async () => {
      const { host, hostSeat, gameId } = await hostWithGuest();
      const reconnected = await connect();

      const rejoined = await emitAck<Seat>(reconnected, 'game:rejoin', {
        gameId, previousPlayerId: hostSeat.playerId, rejoinToken: hostSeat.rejoinToken
      });
      expect(rejoined.ok).toBe(true);
      if (!rejoined.ok) return;
      expect(rejoined.data.gameState.hostId).toBe(reconnected.id);
      expect(rejoined.data.rejoinToken).not.toBe(hostSeat.rejoinToken);

      const thief = await connect();
      const replay = await emitAck(thief, 'game:rejoin', {
        gameId, previousPlayerId: reconnected.id, rejoinToken: hostSeat.rejoinToken
      });
      expect(replay.ok).toBe(false);

      host.disconnect();
      reconnected.disconnect();
      thief.disconnect();
    });

    it('stops the replaced socket from receiving the room broadcasts', async () => {
      const { host, hostSeat, gameId } = await hostWithGuest();
      const reconnected = await connect();
      let oldSocketUpdates = 0;
      host.on('game:updated', () => { oldSocketUpdates += 1; });

      await emitAck(reconnected, 'game:rejoin', {
        gameId, previousPlayerId: hostSeat.playerId, rejoinToken: hostSeat.rejoinToken
      });
      const baseline = oldSocketUpdates;
      const guest = await connect();
      await emitAck(guest, 'game:join', { gameId, playerName: 'Guest' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(oldSocketUpdates).toBe(baseline);

      host.disconnect();
      reconnected.disconnect();
      guest.disconnect();
    });
  });

  describe('hidden information', () => {
    type View = { gameId: string; players: Array<{ id: string; name: string; hand: Array<{ value: number }> }>; drawPile: Array<{ value: number }> };

    const emitAck = <T>(socket: Socket, event: string, payload: unknown) =>
      new Promise<Ack<T>>((resolve) => socket.emit(event, payload, (ack: Ack<T>) => resolve(ack)));

    async function startedGame(allowCardLookup: boolean) {
      const host = await connect();
      const guest = await connect();
      const created = await emitAck<{ gameState: View }>(host, 'game:create', {
        playerName: 'Host',
        isSolitaire: false,
        settings: {
          minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
          autoRefillHand: false, allowUndo: false, privateGame: false, allowCardLookup, showArrows: true
        }
      });
      if (!created.ok) throw new Error('create failed');
      const gameId = created.data.gameState.gameId;
      await emitAck(guest, 'game:join', { gameId, playerName: 'Guest' });
      const guestUpdate = new Promise<View>((resolve) => guest.once('game:updated', (state: View) => resolve(state)));
      const started = await emitAck<{ gameState: View }>(host, 'game:start', { gameId });
      if (!started.ok) throw new Error('start failed');
      return { host, guest, gameId, hostView: started.data.gameState, guestBroadcast: await guestUpdate };
    }

    it('sends each player only their own cards, in acks and in broadcasts', async () => {
      const { host, guest, hostView, guestBroadcast } = await startedGame(false);

      const hostSeatInHostView = hostView.players.find((p) => p.name === 'Host')!;
      const hostSeatInGuestView = guestBroadcast.players.find((p) => p.name === 'Host')!;
      expect(hostSeatInHostView.hand.some((card) => card.value > 0)).toBe(true);
      expect(hostSeatInGuestView.hand.length).toBe(hostSeatInHostView.hand.length);
      expect(hostSeatInGuestView.hand.every((card) => card.value === 0)).toBe(true);
      expect(guestBroadcast.drawPile.length).toBe(hostView.drawPile.length);
      expect(guestBroadcast.drawPile.every((card) => card.value === 0)).toBe(true);
      expect(hostView.drawPile.every((card) => card.value === 0)).toBe(true);

      host.disconnect();
      guest.disconnect();
    });

    it('answers a secret card lookup only to the asker, from server-side cards', async () => {
      const { host, guest, gameId, hostView } = await startedGame(true);
      const hostCardValue = hostView.players.find((p) => p.name === 'Host')!.hand[0]!.value;
      let hostSawBroadcast = false;
      host.on('game:cardLookupResult', () => { hostSawBroadcast = true; });

      const answer = await emitAck<{ result: { status: string; holderName?: string } }>(guest, 'game:cardLookup', {
        gameId, cardValue: hostCardValue, secret: true
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(answer.ok).toBe(true);
      if (answer.ok) {
        expect(answer.data.result.status).toBe('in-hand');
        expect(answer.data.result.holderName).toBe('Host');
      }
      expect(hostSawBroadcast).toBe(false);

      host.disconnect();
      guest.disconnect();
    });
  });

  it('limits game lookups per client IP behind two trusted proxies, so reconnecting or spoofing X-Forwarded-For cannot reset the limit', async () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    const proxied = createRealtimeServer(0);
    delete process.env.TRUSTED_PROXY_HOPS;
    await new Promise<void>((resolve) => proxied.httpServer.listen(0, () => resolve()));
    const proxiedUrl = `http://127.0.0.1:${(proxied.httpServer.address() as AddressInfo).port}`;

    // Container sees: X-Forwarded-For = "<client>, <ALB>" (plus anything the client prepends) and APISIX as the TCP peer.
    const connectVia = (forwardedFor: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = ioClient(proxiedUrl, { transports: ['websocket'], extraHeaders: { 'x-forwarded-for': forwardedFor } });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
      });
    const lookup = (socket: Socket) =>
      new Promise<Ack<unknown>>((resolve) => socket.emit('game:lookup', { gameId: 'ZZZZZZ' }, (ack: Ack<unknown>) => resolve(ack)));

    const attackerSockets = await Promise.all(
      [1, 2, 3, 4].map((n) => connectVia(`spoof-${n}, 9.9.9.9, 10.0.0.1`))
    );
    let rateLimited = 0;
    for (const socket of attackerSockets) {
      for (let i = 0; i < 20; i += 1) {
        const ack = await lookup(socket);
        if (!ack.ok && ack.error.startsWith('Too many')) rateLimited += 1;
      }
    }
    // 80 lookups from one real client against a 60 per window budget, each socket alone under its own limit of 20.
    expect(rateLimited).toBe(20);

    const otherClient = await connectVia('8.8.8.8, 10.0.0.1');
    const other = await lookup(otherClient);
    expect(!other.ok && other.error.startsWith('Too many')).toBe(false);

    [...attackerSockets, otherClient].forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => proxied.httpServer.close(() => resolve()));
  });

  it('creates, joins, and starts a game', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;

    const gameId = createResponse.data.gameState.gameId;

    const joinResponse = await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });

    expect(joinResponse.ok).toBe(true);
    if (!joinResponse.ok) return;
    expect(joinResponse.data.gameState.players.length).toBe(2);

    const startResponse = await new Promise<Ack<{ gameState: { gamePhase: string; players: Array<{ hand: unknown[] }> } }>>((resolve) => {
      host.emit('game:start', { gameId }, (ack: Ack<{ gameState: { gamePhase: string; players: Array<{ hand: unknown[] }> } }>) => resolve(ack));
    });

    expect(startResponse.ok).toBe(true);
    if (!startResponse.ok) return;
    expect(startResponse.data.gameState.gamePhase).toBe('playing');
    expect(startResponse.data.gameState.players[0]?.hand.length).toBe(7);

    host.disconnect();
    guest.disconnect();
  });

  it('allows nas player to use nas cheat once per turn', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'nas',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });

    const startResponse = await new Promise<Ack<{ gameState: { players: Array<{ hand: Array<{ id: string }> }> } }>>((resolve) => {
      host.emit('game:start', { gameId }, (ack: Ack<{ gameState: { players: Array<{ hand: Array<{ id: string }> }> } }>) => resolve(ack));
    });
    expect(startResponse.ok).toBe(true);
    if (!startResponse.ok) return;

    const cardId = startResponse.data.gameState.players[0]?.hand[0]?.id;
    if (!cardId) {
      throw new Error('missing host card');
    }

    const cheatResponse = await new Promise<Ack<{ gameState: { statistics: { players: Record<string, { nasCheatsUsed: number }> }; nasCheat: { usedThisTurnByPlayerId: Record<string, boolean> } } }>>((resolve) => {
      host.emit('game:nasCheat', { gameId, cardId }, (ack: Ack<{ gameState: { statistics: { players: Record<string, { nasCheatsUsed: number }> }; nasCheat: { usedThisTurnByPlayerId: Record<string, boolean> } } }>) => resolve(ack));
    });
    expect(cheatResponse.ok).toBe(true);
    if (!cheatResponse.ok) return;
    expect(cheatResponse.data.gameState.statistics.players[host.id]?.nasCheatsUsed).toBe(1);
    expect(cheatResponse.data.gameState.nasCheat.usedThisTurnByPlayerId[host.id]).toBe(true);

    const secondCheatResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit('game:nasCheat', { gameId, cardId }, (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack));
    });
    expect(secondCheatResponse.ok).toBe(false);

    host.disconnect();
    guest.disconnect();
  });

  it('rejects non-host start attempts', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });

    const badStart = await new Promise<Ack<{ gameState: { gamePhase: string } }>>((resolve) => {
      guest.emit('game:start', { gameId }, (ack: Ack<{ gameState: { gamePhase: string } }>) => resolve(ack));
    });

    expect(badStart.ok).toBe(false);
    if (badStart.ok) return;
    expect(badStart.error).toContain('Only host');

    host.disconnect();
    guest.disconnect();
  });

  it('allows host to update settings in lobby and rejects non-host edits', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });

    const guestUpdate = await new Promise<Ack<{ gameState: { settings: { handSize: number } } }>>((resolve) => {
      guest.emit(
        'game:updateSettings',
        {
          gameId,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 8,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: true,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { settings: { handSize: number } } }>) => resolve(ack)
      );
    });

    expect(guestUpdate.ok).toBe(false);

    const hostUpdate = await new Promise<Ack<{ gameState: { settings: { handSize: number; autoRefillHand: boolean } } }>>((resolve) => {
      host.emit(
        'game:updateSettings',
        {
          gameId,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 8,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 1,
            autoRefillHand: true,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { settings: { handSize: number; autoRefillHand: boolean } } }>) => resolve(ack)
      );
    });

    expect(hostUpdate.ok).toBe(true);
    if (!hostUpdate.ok) return;
    expect(hostUpdate.data.gameState.settings.handSize).toBe(8);
    expect(hostUpdate.data.gameState.settings.autoRefillHand).toBe(true);

    const badHostUpdate = await new Promise<Ack<{ gameState: { settings: { minPlayers: number } } }>>((resolve) => {
      host.emit(
        'game:updateSettings',
        {
          gameId,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 8,
            minPlayers: 1,
            maxPlayers: 1,
            minCardsPerTurn: 1,
            autoRefillHand: true,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { settings: { minPlayers: number } } }>) => resolve(ack)
      );
    });
    expect(badHostUpdate.ok).toBe(false);

    host.disconnect();
    guest.disconnect();
  });

  it('allows only host to end an active game', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 6,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: false,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });

    await new Promise<Ack<{ gameState: { gamePhase: string } }>>((resolve) => {
      host.emit('game:start', { gameId }, (ack: Ack<{ gameState: { gamePhase: string } }>) => resolve(ack));
    });

    const guestEnd = await new Promise<Ack<{ gameState: { gamePhase: string } }>>((resolve) => {
      guest.emit('game:endGame', { gameId }, (ack: Ack<{ gameState: { gamePhase: string } }>) => resolve(ack));
    });
    expect(guestEnd.ok).toBe(false);

    const hostEnd = await new Promise<Ack<{ gameState: { gamePhase: string } }>>((resolve) => {
      host.emit('game:endGame', { gameId }, (ack: Ack<{ gameState: { gamePhase: string } }>) => resolve(ack));
    });
    expect(hostEnd.ok).toBe(true);
    if (!hostEnd.ok) return;
    expect(hostEnd.data.gameState.gamePhase).toBe('lobby');

    host.disconnect();
    guest.disconnect();
  });

  it('shows private lookup occupancy and blocks full joins with a friendly message', async () => {
    const host = await connect();
    const guest = await connect();
    const extra = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 2,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: true,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    const lookupBeforeJoin = await new Promise<Ack<{ game: { playerCount: number; maxPlayers: number; privateGame: boolean } }>>((resolve) => {
      guest.emit('game:lookup', { gameId }, (ack: Ack<{ game: { playerCount: number; maxPlayers: number; privateGame: boolean } }>) => resolve(ack));
    });
    expect(lookupBeforeJoin.ok).toBe(true);
    if (!lookupBeforeJoin.ok) return;
    expect(lookupBeforeJoin.data.game.playerCount).toBe(1);
    expect(lookupBeforeJoin.data.game.maxPlayers).toBe(2);
    expect(lookupBeforeJoin.data.game.privateGame).toBe(true);

    const guestJoin = await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      guest.emit('game:join', { gameId, playerName: 'Guest' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });
    expect(guestJoin.ok).toBe(true);

    const fullJoin = await new Promise<Ack<{ gameState: { players: Array<{ id: string }> } }>>((resolve) => {
      extra.emit('game:join', { gameId, playerName: 'Extra' }, (ack: Ack<{ gameState: { players: Array<{ id: string }> } }>) => resolve(ack));
    });
    expect(fullJoin.ok).toBe(false);
    if (fullJoin.ok) return;
    expect(fullJoin.error).toContain('not available');

    const lookupWhenFull = await new Promise<Ack<{ game: { playerCount: number } }>>((resolve) => {
      extra.emit('game:lookup', { gameId }, (ack: Ack<{ game: { playerCount: number } }>) => resolve(ack));
    });
    expect(lookupWhenFull.ok).toBe(false);
    if (lookupWhenFull.ok) return;
    expect(lookupWhenFull.error).toBe(fullJoin.error);

    host.disconnect();
    guest.disconnect();
    extra.disconnect();
  });

  it('rate limits repeated lookup attempts', async () => {
    const host = await connect();
    const guest = await connect();

    const createResponse = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      host.emit(
        'game:create',
        {
          playerName: 'Host',
          isSolitaire: false,
          settings: {
            minCardValue: 2,
            maxCardValue: 99,
            handSize: 7,
            minPlayers: 2,
            maxPlayers: 4,
            minCardsPerTurn: 2,
            autoRefillHand: false,
            allowUndo: false,
            privateGame: true,
            allowCardLookup: false, showArrows: true
          }
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) return;
    const gameId = createResponse.data.gameState.gameId;

    let lastAck: Ack<{ game: { gameId: string } }> | null = null;
    for (let i = 0; i < 21; i += 1) {
      lastAck = await new Promise<Ack<{ game: { gameId: string } }>>((resolve) => {
        guest.emit('game:lookup', { gameId }, (ack: Ack<{ game: { gameId: string } }>) => resolve(ack));
      });
    }

    expect(lastAck).not.toBeNull();
    expect(lastAck?.ok).toBe(false);
    if (lastAck?.ok) return;
    expect(lastAck.error).toContain('Too many lookup attempts');

    host.disconnect();
    guest.disconnect();
  });

  it('rejects malformed payloads with stable error acknowledgements', async () => {
    const socket = await connect();

    const badCreate = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      socket.emit(
        'game:create',
        {
          playerName: 'Host'
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });
    expect(badCreate.ok).toBe(false);
    if (!badCreate.ok) {
      expect(typeof badCreate.error).toBe('string');
      expect(badCreate.error.length).toBeGreaterThan(0);
    }

    const badJoin = await new Promise<Ack<{ gameState: { gameId: string } }>>((resolve) => {
      socket.emit(
        'game:join',
        {
          gameId: 123,
          playerName: true
        },
        (ack: Ack<{ gameState: { gameId: string } }>) => resolve(ack)
      );
    });
    expect(badJoin.ok).toBe(false);
    if (!badJoin.ok) {
      expect(typeof badJoin.error).toBe('string');
      expect(badJoin.error.length).toBeGreaterThan(0);
    }

    socket.disconnect();
  });
});
