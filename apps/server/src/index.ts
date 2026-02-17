import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import {
  createGamePayloadSchema,
  joinGamePayloadSchema,
  playCardPayloadSchema,
  updateSettingsPayloadSchema
} from '@upndown/shared-types';
import { GameManager } from './game-manager.js';

const gameIdSchema = z.object({ gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/) });

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;

export function createRealtimeServer(port = Number(process.env.PORT ?? 3001)) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'upndown-server' });
  });

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*'
    }
  });

  const manager = new GameManager();
  const connectedPlayerIds = new Set<string>();
  const cleanupTimer = setInterval(() => {
    manager.reapOrphanedRooms(connectedPlayerIds, Date.now());
  }, 60_000);
  cleanupTimer.unref();

  io.on('connection', (socket) => {
    connectedPlayerIds.add(socket.id);
    socket.emit('server:ready', { message: 'connected', playerId: socket.id });

    socket.on('game:create', (payload, ack?: Ack<{ gameState: unknown; playerId: string }>) => {
      try {
        const parsed = createGamePayloadSchema.parse(payload);
        const gameState = manager.createGame(socket.id, parsed);
        socket.join(gameState.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState, playerId: socket.id } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to create game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:join', (payload, ack?: Ack<{ gameState: unknown; playerId: string }>) => {
      try {
        const parsed = joinGamePayloadSchema.parse(payload);
        const gameState = manager.joinGame(socket.id, parsed);
        socket.join(gameState.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState, playerId: socket.id } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to join game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:listJoinable', (_payload, ack?: Ack<{ games: unknown[] }>) => {
      try {
        const games = manager.listJoinableGames();
        ack?.({ ok: true, data: { games } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to list games';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:lookup', (payload, ack?: Ack<{ game: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const game = manager.lookupJoinableGame(parsed.gameId);
        ack?.({ ok: true, data: { game } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to lookup game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:start', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.startGame(socket.id, parsed.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:playCard', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = playCardPayloadSchema.parse(payload);
        const gameState = manager.playCard(socket.id, parsed);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to play card';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:endTurn', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.endTurn(socket.id, parsed.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to end turn';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:endGame', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.endGame(socket.id, parsed.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to end game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:updateSettings', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = updateSettingsPayloadSchema.parse(payload);
        const gameState = manager.updateSettings(socket.id, parsed);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to update settings';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:leave', (payload, ack?: Ack<{ gameState: unknown | null }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.leaveGame(socket.id, parsed.gameId);
        socket.leave(parsed.gameId);
        if (gameState) {
          io.to(parsed.gameId).emit('game:updated', gameState);
        }
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to leave game';
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('disconnect', () => {
      connectedPlayerIds.delete(socket.id);
      const updates = manager.removeDisconnectedPlayer(socket.id);
      for (const update of updates) {
        if (update.gameState) {
          io.to(update.gameId).emit('game:updated', update.gameState);
        }
      }
    });
  });

  return { app, io, httpServer, start: () => httpServer.listen(port) };
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3001);
  const { start } = createRealtimeServer(port);
  start();
  console.log(`UpNDown server listening on http://localhost:${port}`);
}
