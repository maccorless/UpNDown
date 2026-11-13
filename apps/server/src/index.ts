import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  cardLookupPayloadSchema,
  createGamePayloadSchema,
  joinGamePayloadSchema,
  kickPlayerPayloadSchema,
  nasCheatPayloadSchema,
  playCardPayloadSchema,
  rejoinGamePayloadSchema,
  setReactionPayloadSchema,
  updateSettingsPayloadSchema
} from '@upndown/shared-types';
import { GameManager } from './game-manager.js';
import { toPlayerView } from './player-view.js';

const gameIdSchema = z.object({ gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/) });
const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALLOWED_ORIGINS: z.string().optional(),
  CLIENT_DIST_DIR: z.string().min(1).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  DEPLOY_TARGET: z.enum(['skiff', 'railway']).optional()
});

// Reverse proxies in front of the server per platform (Skiff: ALB + APISIX). Explicit TRUSTED_PROXY_HOPS wins.
const proxyHopsByTarget = { skiff: 2, railway: 1 } as const;

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;
type LogLevel = 'info' | 'warn' | 'error';

// Socket.IO passes a non-function last client argument through as `ack`, so check the type at runtime.
function reply<T>(ack: Ack<T> | undefined, response: Parameters<Ack<T>>[0]): void {
  if (typeof ack === 'function') {
    ack(response);
  }
}

interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  allowedOrigins: string[];
  clientDistDir: string | undefined;
  trustedProxyHops: number;
}

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const eventRateLimits: Record<
  | 'game:create'
  | 'game:join'
  | 'game:rejoin'
  | 'game:lookup'
  | 'game:listJoinable'
  | 'game:start'
  | 'game:playCard'
  | 'game:nasCheat'
  | 'game:endTurn'
  | 'game:undoPlay'
  | 'game:endGame'
  | 'game:updateSettings'
  | 'game:leave'
  | 'game:kickPlayer'
  | 'game:setReaction'
  | 'game:cardLookup',
  RateLimitRule
> = {
  'game:create':         { limit: 5,  windowMs: 60_000 },
  'game:join':           { limit: 10, windowMs: 10_000 },
  'game:rejoin':         { limit: 5,  windowMs: 30_000 },
  'game:lookup':         { limit: 20, windowMs: 10_000 },
  'game:listJoinable':   { limit: 30, windowMs: 10_000 },
  'game:start':          { limit: 10, windowMs: 30_000 },
  'game:playCard':       { limit: 60, windowMs: 10_000 },
  'game:nasCheat':       { limit: 30, windowMs: 10_000 },
  'game:endTurn':        { limit: 30, windowMs: 10_000 },
  'game:undoPlay':       { limit: 30, windowMs: 10_000 },
  'game:endGame':        { limit: 10, windowMs: 30_000 },
  'game:updateSettings': { limit: 20, windowMs: 10_000 },
  'game:leave':          { limit: 10, windowMs: 30_000 },
  'game:kickPlayer':     { limit: 10, windowMs: 10_000 },
  'game:setReaction':    { limit: 20, windowMs: 10_000 },
  'game:cardLookup':     { limit: 10, windowMs: 10_000 }
};

// Per client IP, on top of the per-socket limits: reconnecting resets a socket's bucket, so these stop id guessing.
const ipRateLimits: Partial<Record<keyof typeof eventRateLimits, RateLimitRule>> = {
  'game:lookup': { limit: 60, windowMs: 10_000 },
  'game:join':   { limit: 30, windowMs: 10_000 }
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
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    CLIENT_DIST_DIR: process.env.CLIENT_DIST_DIR,
    TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
    DEPLOY_TARGET: process.env.DEPLOY_TARGET
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
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    clientDistDir: parsed.CLIENT_DIST_DIR ? path.resolve(parsed.CLIENT_DIST_DIR) : undefined,
    trustedProxyHops: parsed.TRUSTED_PROXY_HOPS
      ?? (parsed.DEPLOY_TARGET ? proxyHopsByTarget[parsed.DEPLOY_TARGET] : 0)
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
    // Name the origin: the bare error says nothing about who was refused. Cap it, since the header is client-controlled.
    log('warn', 'cors.origin_rejected', { origin: String(origin).slice(0, 200) });
    callback(new Error('Origin not allowed by CORS'));
  };

  const app = express();
  app.use(cors({ origin: corsOriginHandler }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'upndown-server', uptimeSec: Math.floor(process.uptime()) });
  });

  // Single-container deploys (Skiff) serve the built client from the socket server's origin.
  const { clientDistDir } = config;
  if (clientDistDir) {
    app.use(express.static(clientDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOriginHandler
    }
  });

  const manager = new GameManager();
  const broadcastState = (gameId: string, state: Parameters<typeof toPlayerView>[0]): void => {
    for (const socketId of io.sockets.adapter.rooms.get(gameId) ?? []) {
      io.to(socketId).emit('game:updated', toPlayerView(state, socketId));
    }
  };
  const connectedPlayerIds = new Set<string>();
  const rateBuckets = new Map<string, Map<string, { windowStartMs: number; count: number }>>();

  // Chain is X-Forwarded-For plus the TCP peer. Each trusted proxy appends the address it saw, so the
  // client is `trustedProxyHops` entries from the right and anything an attacker prepends sits to its left.
  const clientIpOf = (socket: Socket): string => {
    const header = socket.handshake.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(header) ? header.join(',') : header ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const chain = [...forwarded, socket.handshake.address];
    return chain[Math.max(0, chain.length - 1 - config.trustedProxyHops)] ?? socket.handshake.address;
  };

  const passesRateLimit = (
    socketId: string,
    eventName: keyof typeof eventRateLimits,
    rule: RateLimitRule = eventRateLimits[eventName]
  ): boolean => {
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
  const passesIpRateLimit = (socket: Socket, eventName: keyof typeof eventRateLimits): boolean => {
    const rule = ipRateLimits[eventName];
    return rule ? passesRateLimit(`ip:${clientIpOf(socket)}`, eventName, rule) : true;
  };
  const cleanupTimer = setInterval(() => {
    const nowMs = Date.now();
    for (const [key, buckets] of rateBuckets) {
      if (!key.startsWith('ip:')) continue;
      for (const [eventName, bucket] of buckets) {
        const rule = ipRateLimits[eventName as keyof typeof eventRateLimits];
        if (!rule || nowMs - bucket.windowStartMs >= rule.windowMs) buckets.delete(eventName);
      }
      if (buckets.size === 0) rateBuckets.delete(key);
    }
    const deletedGameIds = manager.reapOrphanedRooms(connectedPlayerIds, Date.now());
    if (deletedGameIds.length > 0) {
      log('info', 'game.orphans_reaped', { count: deletedGameIds.length, gameIds: deletedGameIds });
    }
  }, 60_000);
  cleanupTimer.unref();

  io.on('connection', (socket) => {
    connectedPlayerIds.add(socket.id);
    log('info', 'socket.connected', { socketId: socket.id, clientIp: clientIpOf(socket) });
    socket.emit('server:ready', { message: 'connected', playerId: socket.id });

    socket.on('game:rejoin', (payload, ack?: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }>) => {
      if (!passesRateLimit(socket.id, 'game:rejoin')) {
        const message = 'Too many rejoin attempts. Please wait a moment and try again.';
        log('warn', 'game.rejoin_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const { gameId, previousPlayerId, rejoinToken } = rejoinGamePayloadSchema.parse(payload);
        const gameState = manager.rejoinPlayer(gameId, previousPlayerId, socket.id, rejoinToken);
        io.in(previousPlayerId).socketsLeave(gameId);
        socket.join(gameId);
        broadcastState(gameId, gameState);
        log('info', 'game.rejoined', { socketId: socket.id, previousId: previousPlayerId, gameId });
        reply(ack, {
          ok: true,
          data: { gameState: toPlayerView(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameId, socket.id) }
        });
      } catch (err) {
        const message = normalizeError(err, 'Unable to rejoin game');
        log('warn', 'game.rejoin_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:create', (payload, ack?: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }>) => {
      if (!passesRateLimit(socket.id, 'game:create')) {
        const message = 'Too many create attempts. Please wait a moment and try again.';
        log('warn', 'game.create_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = createGamePayloadSchema.parse(payload);
        const gameState = manager.createGame(socket.id, parsed);
        socket.join(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.created', { socketId: socket.id, gameId: gameState.gameId, hostId: socket.id });
        reply(ack, {
          ok: true,
          data: { gameState: toPlayerView(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameState.gameId, socket.id) }
        });
      } catch (err) {
        const message = normalizeError(err, 'Unable to create game');
        log('warn', 'game.create_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:join', (payload, ack?: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }>) => {
      if (!passesRateLimit(socket.id, 'game:join') || !passesIpRateLimit(socket, 'game:join')) {
        const message = 'Too many join attempts. Please wait a moment and try again.';
        log('warn', 'game.join_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = joinGamePayloadSchema.parse(payload);
        const gameState = manager.joinGame(socket.id, parsed);
        socket.join(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.joined', { socketId: socket.id, gameId: gameState.gameId });
        reply(ack, {
          ok: true,
          data: { gameState: toPlayerView(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameState.gameId, socket.id) }
        });
      } catch (err) {
        const message = normalizeError(err, 'Unable to join game');
        log('warn', 'game.join_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:listJoinable', (_payload, ack?: Ack<{ games: unknown[] }>) => {
      if (!passesRateLimit(socket.id, 'game:listJoinable')) {
        const message = 'Too many list requests. Please wait a moment and try again.';
        log('warn', 'game.list_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const games = manager.listJoinableGames(connectedPlayerIds);
        reply(ack, { ok: true, data: { games } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to list games');
        log('warn', 'game.list_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:lookup', (payload, ack?: Ack<{ game: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:lookup') || !passesIpRateLimit(socket, 'game:lookup')) {
        const message = 'Too many lookup attempts. Please wait a moment and try again.';
        log('warn', 'game.lookup_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const game = manager.lookupJoinableGame(parsed.gameId);
        reply(ack, { ok: true, data: { game } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to lookup game');
        log('warn', 'game.lookup_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:start', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:start')) {
        const message = 'Too many start attempts. Please wait a moment and try again.';
        log('warn', 'game.start_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.startGame(socket.id, parsed.gameId);
        manager.clearAllReactions(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        io.to(gameState.gameId).emit('game:reactionsUpdated', {});
        log('info', 'game.started', { socketId: socket.id, gameId: gameState.gameId });
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to start game');
        log('warn', 'game.start_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:playCard', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:playCard')) {
        const message = 'Too many play attempts. Please wait a moment and try again.';
        log('warn', 'game.play_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = playCardPayloadSchema.parse(payload);
        const oldSpecialPlays = manager.getSpecialPlays(parsed.gameId, socket.id);
        const gameState = manager.playCard(socket.id, parsed);
        const newSpecialPlays = gameState.statistics.players[socket.id]?.specialPlays ?? 0;
        if (newSpecialPlays > oldSpecialPlays) {
          io.to(gameState.gameId).emit('game:specialPlay', { pileId: parsed.pileId, playerId: socket.id });
        }
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to play card');
        log('warn', 'game.play_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:nasCheat', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:nasCheat')) {
        const message = 'Too many cheat attempts. Please wait a moment and try again.';
        log('warn', 'game.nas_cheat_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = nasCheatPayloadSchema.parse(payload);
        const gameState = manager.nasCheat(socket.id, parsed);
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to use Nas cheat');
        log('warn', 'game.nas_cheat_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:endTurn', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:endTurn')) {
        const message = 'Too many end-turn attempts. Slow down!';
        log('warn', 'game.end_turn_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.endTurn(socket.id, parsed.gameId);
        const newCurrentPlayerId = gameState.players[gameState.currentPlayerIndex]?.id;
        if (newCurrentPlayerId) {
          manager.clearPlayerReactions(gameState.gameId, newCurrentPlayerId);
        }
        const reactions = manager.getReactions(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        io.to(gameState.gameId).emit('game:reactionsUpdated', reactions);
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to end turn');
        log('warn', 'game.end_turn_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:undoPlay', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:undoPlay')) {
        reply(ack, { ok: false, error: 'Too many undo attempts. Slow down!' });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.undoLastPlay(socket.id, parsed.gameId);
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to undo');
        log('warn', 'game.undo_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:endGame', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:endGame')) {
        const message = 'Too many end-game requests. Slow down!';
        log('warn', 'game.end_game_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.endGame(socket.id, parsed.gameId);
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.ended', { socketId: socket.id, gameId: gameState.gameId });
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to end game');
        log('warn', 'game.end_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:updateSettings', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:updateSettings')) {
        const message = 'Too many settings updates. Slow down!';
        log('warn', 'game.update_settings_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = updateSettingsPayloadSchema.parse(payload);
        const gameState = manager.updateSettings(socket.id, parsed);
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to update settings');
        log('warn', 'game.update_settings_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:kickPlayer', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:kickPlayer')) {
        reply(ack, { ok: false, error: 'Too many kick attempts. Slow down!' });
        return;
      }
      try {
        const parsed = kickPlayerPayloadSchema.parse(payload);
        const gameState = manager.kickPlayer(socket.id, parsed);
        // Notify the kicked player
        io.to(parsed.targetPlayerId).emit('game:kicked', { gameId: parsed.gameId });
        // Force the kicked player's socket to leave the room
        const kickedSocket = io.sockets.sockets.get(parsed.targetPlayerId);
        if (kickedSocket) {
          kickedSocket.leave(parsed.gameId);
        }
        // Broadcast updated state to remaining players
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.player_kicked', { socketId: socket.id, gameId: parsed.gameId, kickedPlayerId: parsed.targetPlayerId });
        reply(ack, { ok: true, data: { gameState: toPlayerView(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to kick player');
        log('warn', 'game.kick_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:leave', (payload, ack?: Ack<{ gameState: unknown | null }>) => {
      if (!passesRateLimit(socket.id, 'game:leave')) {
        const message = 'Too many leave requests. Please wait a moment and try again.';
        log('warn', 'game.leave_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        manager.clearPlayerReactions(parsed.gameId, socket.id);
        const gameState = manager.leaveGame(socket.id, parsed.gameId);
        socket.leave(parsed.gameId);
        if (gameState) {
          const reactions = manager.getReactions(parsed.gameId);
          broadcastState(parsed.gameId, gameState);
          io.to(parsed.gameId).emit('game:reactionsUpdated', reactions);
        }
        log('info', 'game.left', { socketId: socket.id, gameId: parsed.gameId });
        reply(ack, { ok: true, data: { gameState: gameState ? toPlayerView(gameState, socket.id) : null } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to leave game');
        log('warn', 'game.leave_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:setReaction', (payload, ack?: Ack<Record<string, never>>) => {
      if (!passesRateLimit(socket.id, 'game:setReaction')) {
        reply(ack, { ok: false, error: 'Too many reactions. Slow down!' });
        return;
      }
      try {
        const parsed = setReactionPayloadSchema.parse(payload);
        manager.setReaction(parsed.gameId, socket.id, parsed.pileId, parsed.reactionType);
        const reactions = manager.getReactions(parsed.gameId);
        io.to(parsed.gameId).emit('game:reactionsUpdated', reactions);
        reply(ack, { ok: true, data: {} });
      } catch (err) {
        const message = normalizeError(err, 'Unable to set reaction');
        log('warn', 'game.set_reaction_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:cardLookup', (payload, ack?: Ack<{ result?: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:cardLookup')) {
        reply(ack, { ok: false, error: 'Too many lookups. Slow down!' });
        return;
      }
      try {
        const parsed = cardLookupPayloadSchema.parse(payload);
        const { status, playerName, holderName } = manager.lookupCardStatus(parsed.gameId, socket.id, parsed.cardValue);
        const result = { cardValue: parsed.cardValue, status, playerName, ...(holderName ? { holderName } : {}) };
        log('info', 'game.card_lookup', { socketId: socket.id, gameId: parsed.gameId, cardValue: parsed.cardValue, status, secret: parsed.secret === true });
        if (parsed.secret) {
          reply(ack, { ok: true, data: { result: { ...result, playerName: '' } } });
          return;
        }
        io.to(parsed.gameId).emit('game:cardLookupResult', result);
        reply(ack, { ok: true, data: {} });
      } catch (err) {
        const message = normalizeError(err, 'Unable to look up card');
        log('warn', 'game.card_lookup_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('disconnect', () => {
      connectedPlayerIds.delete(socket.id);
      rateBuckets.delete(socket.id);
      const updates = manager.removeDisconnectedPlayer(socket.id);
      for (const update of updates) {
        if (update.gameState) {
          broadcastState(update.gameId, update.gameState);
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
