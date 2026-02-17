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
const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALLOWED_ORIGINS: z.string().optional()
});

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;
type LogLevel = 'info' | 'warn' | 'error';

interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  allowedOrigins: string[];
}

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const eventRateLimits: Record<'game:join' | 'game:lookup' | 'game:playCard', RateLimitRule> = {
  'game:join': { limit: 10, windowMs: 10_000 },
  'game:lookup': { limit: 20, windowMs: 10_000 },
  'game:playCard': { limit: 60, windowMs: 10_000 }
};

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0);
}

function loadRuntimeConfig(portOverride?: number): RuntimeConfig {
  const parsed = runtimeEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  });

  const configuredOrigins = parseAllowedOrigins(parsed.ALLOWED_ORIGINS);
  if (parsed.NODE_ENV === 'production' && configuredOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required in production.');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: portOverride ?? parsed.PORT,
    allowedOrigins: configuredOrigins.length > 0
      ? configuredOrigins
      : ['http://localhost:5173', 'http://127.0.0.1:5173']
  };
}

function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };
  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function normalizeError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function createRealtimeServer(port?: number) {
  const config = loadRuntimeConfig(port);
  const isOriginAllowed = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }
    return config.allowedOrigins.includes(origin);
  };
  const corsOriginHandler: cors.CorsOptions['origin'] = (origin, callback) => {
    if (isOriginAllowed(origin ?? undefined)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  };

  const app = express();
  app.use(cors({ origin: corsOriginHandler }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'upndown-server', uptimeSec: Math.floor(process.uptime()) });
  });

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOriginHandler
    }
  });

  const manager = new GameManager();
  const connectedPlayerIds = new Set<string>();
  const rateBuckets = new Map<string, Map<string, { windowStartMs: number; count: number }>>();

  const passesRateLimit = (socketId: string, eventName: keyof typeof eventRateLimits): boolean => {
    const rule = eventRateLimits[eventName];
    const now = Date.now();
    let socketBuckets = rateBuckets.get(socketId);
    if (!socketBuckets) {
      socketBuckets = new Map();
      rateBuckets.set(socketId, socketBuckets);
    }

    const bucket = socketBuckets.get(eventName);
    if (!bucket || now - bucket.windowStartMs >= rule.windowMs) {
      socketBuckets.set(eventName, { windowStartMs: now, count: 1 });
      return true;
    }

    if (bucket.count >= rule.limit) {
      return false;
    }

    bucket.count += 1;
    socketBuckets.set(eventName, bucket);
    return true;
  };
  const cleanupTimer = setInterval(() => {
    const deletedGameIds = manager.reapOrphanedRooms(connectedPlayerIds, Date.now());
    if (deletedGameIds.length > 0) {
      log('info', 'game.orphans_reaped', { count: deletedGameIds.length, gameIds: deletedGameIds });
    }
  }, 60_000);
  cleanupTimer.unref();

  io.on('connection', (socket) => {
    connectedPlayerIds.add(socket.id);
    log('info', 'socket.connected', { socketId: socket.id });
    socket.emit('server:ready', { message: 'connected', playerId: socket.id });

    socket.on('game:create', (payload, ack?: Ack<{ gameState: unknown; playerId: string }>) => {
      try {
        const parsed = createGamePayloadSchema.parse(payload);
        const gameState = manager.createGame(socket.id, parsed);
        socket.join(gameState.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        log('info', 'game.created', { socketId: socket.id, gameId: gameState.gameId, hostId: socket.id });
        ack?.({ ok: true, data: { gameState, playerId: socket.id } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to create game');
        log('warn', 'game.create_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:join', (payload, ack?: Ack<{ gameState: unknown; playerId: string }>) => {
      if (!passesRateLimit(socket.id, 'game:join')) {
        const message = 'Too many join attempts. Please wait a moment and try again.';
        log('warn', 'game.join_rate_limited', { socketId: socket.id });
        ack?.({ ok: false, error: message });
        return;
      }
      try {
        const parsed = joinGamePayloadSchema.parse(payload);
        const gameState = manager.joinGame(socket.id, parsed);
        socket.join(gameState.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        log('info', 'game.joined', { socketId: socket.id, gameId: gameState.gameId });
        ack?.({ ok: true, data: { gameState, playerId: socket.id } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to join game');
        log('warn', 'game.join_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:listJoinable', (_payload, ack?: Ack<{ games: unknown[] }>) => {
      try {
        const games = manager.listJoinableGames(connectedPlayerIds);
        ack?.({ ok: true, data: { games } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to list games');
        log('warn', 'game.list_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:lookup', (payload, ack?: Ack<{ game: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:lookup')) {
        const message = 'Too many lookup attempts. Please wait a moment and try again.';
        log('warn', 'game.lookup_rate_limited', { socketId: socket.id });
        ack?.({ ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const game = manager.lookupJoinableGame(parsed.gameId);
        ack?.({ ok: true, data: { game } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to lookup game');
        log('warn', 'game.lookup_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:start', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.startGame(socket.id, parsed.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        log('info', 'game.started', { socketId: socket.id, gameId: gameState.gameId });
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to start game');
        log('warn', 'game.start_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:playCard', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:playCard')) {
        const message = 'Too many play attempts. Please wait a moment and try again.';
        log('warn', 'game.play_rate_limited', { socketId: socket.id });
        ack?.({ ok: false, error: message });
        return;
      }
      try {
        const parsed = playCardPayloadSchema.parse(payload);
        const gameState = manager.playCard(socket.id, parsed);
        io.to(gameState.gameId).emit('game:updated', gameState);
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to play card');
        log('warn', 'game.play_failed', { socketId: socket.id, error: message });
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
        const message = normalizeError(err, 'Unable to end turn');
        log('warn', 'game.end_turn_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('game:endGame', (payload, ack?: Ack<{ gameState: unknown }>) => {
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.endGame(socket.id, parsed.gameId);
        io.to(gameState.gameId).emit('game:updated', gameState);
        log('info', 'game.ended', { socketId: socket.id, gameId: gameState.gameId });
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to end game');
        log('warn', 'game.end_failed', { socketId: socket.id, error: message });
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
        const message = normalizeError(err, 'Unable to update settings');
        log('warn', 'game.update_settings_failed', { socketId: socket.id, error: message });
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
        log('info', 'game.left', { socketId: socket.id, gameId: parsed.gameId });
        ack?.({ ok: true, data: { gameState } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to leave game');
        log('warn', 'game.leave_failed', { socketId: socket.id, error: message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('disconnect', () => {
      connectedPlayerIds.delete(socket.id);
      rateBuckets.delete(socket.id);
      const updates = manager.removeDisconnectedPlayer(socket.id);
      for (const update of updates) {
        if (update.gameState) {
          io.to(update.gameId).emit('game:updated', update.gameState);
        }
      }
      log('info', 'socket.disconnected', { socketId: socket.id });
    });
  });

  const stop = async (): Promise<void> => {
    clearInterval(cleanupTimer);
    await new Promise<void>((resolve, reject) => {
      io.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  };

  return { app, io, httpServer, config, start: () => httpServer.listen(config.port), stop };
}

if (process.env.NODE_ENV !== 'test') {
  const server = createRealtimeServer();
  server.start();
  log('info', 'server.started', { port: server.config.port, nodeEnv: server.config.nodeEnv, allowedOrigins: server.config.allowedOrigins });

  let shuttingDown = false;
  const shutdown = (signal: string, exitCode = 0): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('info', 'server.stopping', { signal });
    void server.stop()
      .then(() => {
        log('info', 'server.stopped', { signal });
        process.exit(exitCode);
      })
      .catch((err) => {
        log('error', 'server.stop_failed', { signal, error: normalizeError(err, 'Failed to stop server') });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('unhandledRejection', (reason) => {
    log('error', 'process.unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason)
    });
  });
  process.on('uncaughtException', (error) => {
    log('error', 'process.uncaught_exception', { error: normalizeError(error, 'Unknown uncaught exception') });
    shutdown('uncaughtException', 1);
  });
}
