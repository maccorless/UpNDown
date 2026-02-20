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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: false
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
            privateGame: true
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
    expect(fullJoin.error).toContain('filled up');

    const lookupWhenFull = await new Promise<Ack<{ game: { playerCount: number } }>>((resolve) => {
      extra.emit('game:lookup', { gameId }, (ack: Ack<{ game: { playerCount: number } }>) => resolve(ack));
    });
    expect(lookupWhenFull.ok).toBe(false);
    if (lookupWhenFull.ok) return;
    expect(lookupWhenFull.error).toContain('full');

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
            privateGame: true
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
