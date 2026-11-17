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
  removeRobotPayloadSchema,
  requestJoinPayloadSchema,
  resolveJoinPayloadSchema,
  skipPayloadSchema,
  tradePayloadSchema,
  playCardPayloadSchema,
  rejoinGamePayloadSchema,
  setReactionPayloadSchema,
  updateSettingsPayloadSchema
} from '@upndown/shared-types';
import type { CheatUsedEvent, JoinRequestEvent, JoinResolvedEvent } from '@upndown/shared-types';
import { createAuthRuntime, type AuthTestOverrides } from './auth/runtime.js';
import { resolveClientIp } from './client-ip.js';
import { GameManager } from './game-manager.js';
import { loadRobotBrain } from './robot-brain.js';
import { toPlayerView } from './player-view.js';
import { AdvisoryLock, type WriterLock } from './live/advisory-lock.js';
import { PgGameStore, type GameStore } from './live/game-store.js';
import { LivePersistence } from './live/persistence.js';

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

// `gone` on a refused rejoin means the seat no longer exists (or the token is wrong): do not try again. Without it the
// refusal may be temporary (a rate limit), so the client may.
const JOIN_REQUEST_TTL_MS = 2 * 60 * 1000;

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string; gone?: true }) => void;
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
  | 'game:rejoinMine'
  | 'game:mySeats'
  | 'game:lookup'
  | 'game:listJoinable'
  | 'game:start'
  | 'game:playCard'
  | 'game:createInvite'
  | 'game:requestJoin'
  | 'game:resolveJoin'
  | 'game:addRobot'
  | 'game:removeRobot'
  | 'game:skip'
  | 'game:hint'
  | 'game:trade'
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
  'game:rejoinMine':     { limit: 10, windowMs: 30_000 },
  'game:mySeats':        { limit: 10, windowMs: 30_000 },
  'game:lookup':         { limit: 20, windowMs: 10_000 },
  'game:listJoinable':   { limit: 30, windowMs: 10_000 },
  'game:start':          { limit: 10, windowMs: 30_000 },
  'game:playCard':       { limit: 60, windowMs: 10_000 },
  'game:createInvite':   { limit: 10, windowMs: 30_000 },
  'game:requestJoin':    { limit: 5,  windowMs: 30_000 },
  'game:resolveJoin':    { limit: 20, windowMs: 10_000 },
  'game:addRobot':       { limit: 10, windowMs: 10_000 },
  'game:removeRobot':    { limit: 10, windowMs: 10_000 },
  'game:skip':           { limit: 10, windowMs: 10_000 },
  'game:hint':           { limit: 20, windowMs: 10_000 },
  'game:trade':          { limit: 10, windowMs: 10_000 },
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
  'game:join':   { limit: 30, windowMs: 10_000 },
  'game:requestJoin': { limit: 20, windowMs: 30_000 }
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

// `live` is for tests: a store and lock to save games with. In production they are made from the database once it is usable.
export function createRealtimeServer(
  port?: number,
  authOverrides?: AuthTestOverrides,
  timing: { noticeMs?: number; kickMs?: number; robotDelayMs?: number; joinRequestTtlMs?: number } = {},
  live?: { store: GameStore; lock: WriterLock; intervalMs?: number; retryMs?: number }
) {
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
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(cors({ origin: corsOriginHandler }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'upndown-server', uptimeSec: Math.floor(process.uptime()) });
  });

  const auth = createAuthRuntime(process.env, log, { trustedProxyHops: config.trustedProxyHops, ...(authOverrides ? { overrides: authOverrides } : {}) });
  // Before the static handler and the single-page fallback, which would otherwise answer these paths.
  app.use(auth.legacyRedirect);
  app.use(auth.router);
  // An unknown API or auth path is an error, not the client page the catch-all below would hand back with a 200.
  app.use(['/api', '/auth'], (_req, res) => { res.status(404).json({}); });

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
    },
    // Messages here are a few hundred bytes. The default is 1 MB per message.
    maxHttpBufferSize: 16 * 1024
  });

  // A signed-in browser's cookie rides along on the websocket upgrade. The user id stays on the server:
  // `playerId` is still the socket id, and no other player ever sees it. A bad lookup means guest, never a refusal.
  io.use(async (socket, next) => {
    const session = await auth.sessionFromCookie(socket.handshake.headers.cookie);
    if (session) {
      socket.data.userId = session.userId;
      socket.data.sessionId = session.sessionId;
    }
    next();
  });
  auth.onSessionRevoked((sessionId) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionId === sessionId) {
        delete socket.data.userId;
        delete socket.data.sessionId;
      }
    }
  });

  const manager = new GameManager({ onResults: (rows) => auth.recordResults(rows), robotBrain: loadRobotBrain(process.env, (message) => log('info', 'robots.brain', { message })), ...timing });
  // The account behind a socket, from the session cookie at the handshake. Guests have none.
  const userIdOf = (socket: Socket): string | undefined => (typeof socket.data.userId === 'string' ? socket.data.userId : undefined);
  // A connection is in one game at a time. A seat in a lobby or a finished game is simply left (the client forgot to);
  // a game in progress cannot be left, so starting or joining another is refused (leaveGame throws, and says why).
  const leaveStaleSeat = (socket: Socket, exceptGameId?: string): void => {
    const stale = manager.seatedGameOf(socket.id);
    if (!stale || stale === exceptGameId) return;
    let remaining: ReturnType<typeof manager.leaveGame>;
    try {
      remaining = manager.leaveGame(socket.id, stale);
    } catch {
      throw new Error('You are already in a game that is still being played.');
    }
    manager.clearPlayerReactions(stale, socket.id);
    socket.leave(stale);
    if (remaining) broadcastState(stale, remaining);
  };

  // What a viewer sees: their own hand only, plus who has dropped and what they may do about it.
  const viewOf = (state: Parameters<typeof toPlayerView>[0], viewerId: string) =>
    toPlayerView(state, viewerId, manager.reconnectionFor(state.gameId, viewerId));
  const broadcastState = (gameId: string, state: Parameters<typeof toPlayerView>[0]): void => {
    for (const socketId of io.sockets.adapter.rooms.get(gameId) ?? []) {
      io.to(socketId).emit('game:updated', viewOf(state, socketId));
    }
    if (manager.syncRobotReactions(gameId)) io.to(gameId).emit('game:reactionsUpdated', manager.getReactions(gameId));
    scheduleRobot(gameId);
  };

  // Robots. When it is a robot's turn and a person is at the table, one step is planned a human-feeling moment ahead. The
  // step names the exact moment it was planned for (the run, whose turn, how far into it), so one planned for a moment that
  // has passed does nothing. Each step goes through the manager like a person's move and is broadcast, which plans the next.
  const robotTimers = new Set<NodeJS.Timeout>();
  const robotPlanned = new Map<string, string>();
  const robotDelay = (): number => timing.robotDelayMs ?? 800 + Math.floor(Math.random() * 800);
  const scheduleRobot = (gameId: string): void => {
    const due = manager.robotToAct(gameId);
    if (!due || robotPlanned.get(gameId) === due.turnKey) return;
    robotPlanned.set(gameId, due.turnKey);
    const timer = setTimeout(() => {
      robotTimers.delete(timer);
      if (robotPlanned.get(gameId) === due.turnKey) robotPlanned.delete(gameId);
      const done = manager.robotStep(gameId, due.turnKey);
      const state = manager.peekState(gameId);
      if (!done || !state) return;
      if (done.step === 'endTurn') {
        const next = state.players[state.currentPlayerIndex]?.id;
        if (next) manager.clearPlayerReactions(gameId, next);
        io.to(gameId).emit('game:reactionsUpdated', manager.getReactions(gameId));
      }
      if (done.step === 'skip' || done.step === 'trade') announceCheatBy(gameId, done.robotId, done.step);
      log('info', 'game.robot_step', { gameId, step: done.step });
      broadcastState(gameId, state);
    }, robotDelay());
    timer.unref();
    robotTimers.add(timer);
  };
  const announceCheatBy = (gameId: string, playerId: string, kind: CheatUsedEvent['kind']): void => {
    const player = manager.peekState(gameId)?.players.find((p) => p.id === playerId);
    if (player) io.to(gameId).emit('game:cheatUsed', { playerId: player.id, playerName: player.name, kind } satisfies CheatUsedEvent);
  };
  // A dropped player appears to the others after the notice time, and may be kicked after the kick time, so the room is
  // sent a fresh view at each of those moments. A timer that fires after the player came back only sends a harmless update.
  const reconnectionTimers = new Set<NodeJS.Timeout>();
  // A table with robots and no person left is over after the kick time, rather than robots playing on unwatched.
  const abandonLater = (gameId: string): void => {
    const timer = setTimeout(() => {
      reconnectionTimers.delete(timer);
      if (manager.abandonIfOnlyRobotsRemain(gameId)) log('info', 'game.abandoned_robots_only', { gameId });
    }, (timing.kickMs ?? 90_000) + 100);
    timer.unref();
    reconnectionTimers.add(timer);
  };
  const rebroadcastLater = (gameId: string, delayMs: number): void => {
    const timer = setTimeout(() => {
      reconnectionTimers.delete(timer);
      const state = manager.peekState(gameId);
      if (state) broadcastState(gameId, state);
    }, delayMs + 50);
    timer.unref();
    reconnectionTimers.add(timer);
  };
  // Saving games in progress so they survive a restart. Needs the database (or, in tests, a store and a lock).
  let persistence: LivePersistence | undefined;
  const startPersistence = (store: GameStore, lock: WriterLock, extra: { intervalMs?: number; retryMs?: number } = {}): void => {
    if (persistence) return;
    persistence = new LivePersistence({
      manager, store, lock, log, ...extra,
      // After a restart every seat is a dropped connection: tell the table at the usual moments.
      onLoaded: (gameIds) => {
        for (const gameId of gameIds) {
          rebroadcastLater(gameId, timing.noticeMs ?? 10_000);
          rebroadcastLater(gameId, timing.kickMs ?? 90_000);
          abandonLater(gameId);
        }
      }
    });
    auth.degradedWhen(() => persistence?.status() === 'down');
    persistence.start();
  };
  if (live) {
    startPersistence(live.store, live.lock, { ...(live.intervalMs !== undefined ? { intervalMs: live.intervalMs } : {}), ...(live.retryMs !== undefined ? { retryMs: live.retryMs } : {}) });
  } else {
    auth.onEnabled(() => {
      const pool = auth.pool();
      const url = auth.databaseUrl();
      if (pool && url) startPersistence(new PgGameStore(pool), new AdvisoryLock(url));
    });
  }
  const connectedPlayerIds = new Set<string>();
  const rateBuckets = new Map<string, Map<string, { windowStartMs: number; count: number }>>();

  const clientIpOf = (socket: Socket): string =>
    resolveClientIp(socket.handshake.headers['x-forwarded-for'], socket.handshake.address, config.trustedProxyHops);

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

  const finishRejoin = async (
    socket: Socket,
    gameId: string,
    previousPlayerId: string,
    gameState: Parameters<typeof toPlayerView>[0],
    ack: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }> | undefined
  ): Promise<void> => {
    io.in(previousPlayerId).socketsLeave(gameId);
    socket.join(gameId);
    // The seat has a new credential. Have it saved before the client is given it, so a restart right after cannot leave a
    // player holding a token the database has never seen.
    await persistence?.flush(gameId);
    broadcastState(gameId, gameState);
    log('info', 'game.rejoined', { socketId: socket.id, previousId: previousPlayerId, gameId });
    reply(ack, {
      ok: true,
      data: { gameState: viewOf(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameId, socket.id) }
    });
  };

  io.on('connection', (socket) => {
    connectedPlayerIds.add(socket.id);
    // The client address is deliberately not logged. It is only used for rate limits, and nothing needs it on disk.
    log('info', 'socket.connected', { socketId: socket.id });
    socket.emit('server:ready', { message: 'connected', playerId: socket.id });

    socket.on('game:rejoin', async (payload, ack?: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }>) => {
      if (!passesRateLimit(socket.id, 'game:rejoin')) {
        const message = 'Too many rejoin attempts. Please wait a moment and try again.';
        log('warn', 'game.rejoin_rate_limited', { socketId: socket.id });
        reply(ack, { ok: false, error: message });
        return;
      }
      let parsed: ReturnType<typeof rejoinGamePayloadSchema.parse>;
      try {
        parsed = rejoinGamePayloadSchema.parse(payload);
      } catch (err) {
        reply(ack, { ok: false, error: normalizeError(err, 'Unable to rejoin game') });
        return;
      }
      try {
        const { gameId, previousPlayerId, rejoinToken } = parsed;
        const gameState = manager.rejoinPlayer(gameId, previousPlayerId, socket.id, rejoinToken, userIdOf(socket));
        await finishRejoin(socket, gameId, previousPlayerId, gameState, ack);
      } catch (err) {
        log('warn', 'game.rejoin_failed', { socketId: socket.id, error: normalizeError(err, 'Unable to rejoin game') });
        reply(ack, { ok: false, error: 'Unable to rejoin game', gone: true });
      }
    });

    // Which games being played this signed-in connection holds a seat in. Nothing for a guest.
    socket.on('game:mySeats', (_payload, ack?: Ack<{ gameIds: string[] }>) => {
      if (!passesRateLimit(socket.id, 'game:mySeats')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      const userId = userIdOf(socket);
      reply(ack, { ok: true, data: { gameIds: userId ? manager.heldGamesByAccount(userId) : [] } });
    });

    socket.on('game:rejoinMine', async (payload, ack?: Ack<{ gameState: unknown; playerId: string; rejoinToken: string }>) => {
      if (!passesRateLimit(socket.id, 'game:rejoinMine')) {
        reply(ack, { ok: false, error: 'Too many rejoin attempts. Please wait a moment and try again.' });
        return;
      }
      const userId = userIdOf(socket);
      try {
        if (!userId) throw new Error('Unable to rejoin game');
        const wanted = gameIdSchema.safeParse(payload);
        const found = manager.rejoinByAccount(userId, socket.id, wanted.success ? wanted.data.gameId : undefined);
        await finishRejoin(socket, found.gameId, found.previousPlayerId, found.state, ack);
      } catch {
        // Not signed in, or no held seat: nothing to log, this is asked on every multiplayer visit.
        reply(ack, { ok: false, error: 'Unable to rejoin game', gone: true });
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
        leaveStaleSeat(socket);
        const gameState = manager.createGame(socket.id, parsed, userIdOf(socket));
        socket.join(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.created', { socketId: socket.id, gameId: gameState.gameId, hostId: socket.id });
        reply(ack, {
          ok: true,
          data: { gameState: viewOf(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameState.gameId, socket.id) }
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
        leaveStaleSeat(socket, parsed.gameId);
        const gameState = manager.joinGame(socket.id, parsed, userIdOf(socket));
        socket.join(gameState.gameId);
        broadcastState(gameState.gameId, gameState);
        log('info', 'game.joined', { socketId: socket.id, gameId: gameState.gameId });
        reply(ack, {
          ok: true,
          data: { gameState: viewOf(gameState, socket.id), playerId: socket.id, rejoinToken: manager.getRejoinToken(gameState.gameId, socket.id) }
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to play card');
        log('warn', 'game.play_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    // Joining a game that is already being played: the host makes a single-use invitation, a person asks to join with it, and the
    // host lets them in or not. Nothing is taken from the game until the host says yes.
    socket.on('game:createInvite', (payload, ack?: Ack<{ token: string; expiresAtMs: number }>) => {
      if (!passesRateLimit(socket.id, 'game:createInvite')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        reply(ack, { ok: true, data: manager.createInvite(socket.id, parsed.gameId) });
      } catch (err) {
        const message = normalizeError(err, 'Unable to make an invitation');
        log('warn', 'game.invite_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:requestJoin', (payload, ack?: Ack<{ requestId: string }>) => {
      if (!passesRateLimit(socket.id, 'game:requestJoin') || !passesIpRateLimit(socket, 'game:requestJoin')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = requestJoinPayloadSchema.parse(payload);
        const request = manager.requestJoin(socket.id, parsed, userIdOf(socket));
        const hostId = manager.peekState(parsed.gameId)?.hostId;
        if (hostId) io.to(hostId).emit('game:joinRequest', { requestId: request.requestId, playerName: request.playerName } satisfies JoinRequestEvent);
        // A host who does not answer must not leave the person waiting for ever.
        const timer = setTimeout(() => {
          reconnectionTimers.delete(timer);
          const lapsed = manager.dropJoinRequest(parsed.gameId, request.requestId);
          if (!lapsed) return;
          io.to(request.socketId).emit('game:joinResolved', { approved: false, reason: 'The host did not answer in time.' } satisfies JoinResolvedEvent);
          const currentHost = manager.peekState(parsed.gameId)?.hostId;
          if (currentHost) io.to(currentHost).emit('game:joinRequestCancelled', { requestId: request.requestId });
        }, timing.joinRequestTtlMs ?? JOIN_REQUEST_TTL_MS);
        timer.unref();
        reconnectionTimers.add(timer);
        log('info', 'game.join_requested', { socketId: socket.id, gameId: parsed.gameId });
        reply(ack, { ok: true, data: { requestId: request.requestId } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to ask to join');
        log('warn', 'game.request_join_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:resolveJoin', async (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:resolveJoin')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      let parsed: ReturnType<typeof resolveJoinPayloadSchema.parse> | undefined;
      let waiting: { socketId: string } | undefined;
      try {
        parsed = resolveJoinPayloadSchema.parse(payload);
        const gameIdOfRequest = parsed.gameId;
        waiting = manager.pendingJoinRequests(gameIdOfRequest).find((r) => r.requestId === parsed!.requestId);
        const result = manager.resolveJoin(socket.id, parsed);
        if (!result.state || !result.playerId) {
          io.to(result.request.socketId).emit('game:joinResolved', { approved: false, reason: 'The host said no.' } satisfies JoinResolvedEvent);
          reply(ack, { ok: true, data: { gameState: viewOf(manager.peekState(parsed.gameId)!, socket.id) } });
          return;
        }
        io.in(result.playerId).socketsJoin(parsed.gameId);
        // The new seat has a credential: have it saved before the person is given it.
        await persistence?.flush(parsed.gameId);
        io.to(result.playerId).emit('game:joinResolved', {
          approved: true,
          gameState: viewOf(result.state, result.playerId),
          playerId: result.playerId,
          rejoinToken: manager.getRejoinToken(parsed.gameId, result.playerId)
        } satisfies JoinResolvedEvent);
        broadcastState(parsed.gameId, result.state);
        log('info', 'game.player_admitted', { gameId: parsed.gameId, socketId: result.playerId });
        reply(ack, { ok: true, data: { gameState: viewOf(result.state, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to answer the request');
        log('warn', 'game.resolve_join_failed', { socketId: socket.id, error: message });
        // When the request is gone as a result, the person waiting is told why instead of waiting for ever.
        if (parsed && waiting) {
          const stillWaiting = manager.pendingJoinRequests(parsed.gameId).some((r) => r.requestId === parsed!.requestId);
          if (!stillWaiting) io.to(waiting.socketId).emit('game:joinResolved', { approved: false, reason: message } satisfies JoinResolvedEvent);
        }
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:addRobot', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:addRobot')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = gameIdSchema.parse(payload);
        const gameState = manager.addRobot(socket.id, parsed.gameId);
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to add a robot');
        log('warn', 'game.add_robot_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:removeRobot', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:removeRobot')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = removeRobotPayloadSchema.parse(payload);
        const gameState = manager.removeRobot(socket.id, parsed);
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to remove the robot');
        log('warn', 'game.remove_robot_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    // Tells everyone in the room that a cheat was used. Never says what the cheat found.
    const announceCheat = (gameId: string, kind: CheatUsedEvent['kind']): void => announceCheatBy(gameId, socket.id, kind);

    socket.on('game:skip', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:skip')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = skipPayloadSchema.parse(payload);
        const gameState = manager.skip(socket.id, parsed);
        announceCheat(gameState.gameId, 'skip');
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to skip');
        log('warn', 'game.skip_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    // A hint is for the asker alone: nothing is sent to the others, and nothing about the draw pile or other hands is used.
    socket.on('game:hint', (payload, ack?: Ack<{ action: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:hint')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = skipPayloadSchema.parse(payload);
        reply(ack, { ok: true, data: { action: manager.hint(socket.id, parsed) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to give a hint');
        log('warn', 'game.hint_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('game:trade', (payload, ack?: Ack<{ gameState: unknown }>) => {
      if (!passesRateLimit(socket.id, 'game:trade')) {
        reply(ack, { ok: false, error: 'Too many attempts. Please wait a moment and try again.' });
        return;
      }
      try {
        const parsed = tradePayloadSchema.parse(payload);
        const gameState = manager.trade(socket.id, parsed);
        announceCheat(gameState.gameId, 'trade');
        broadcastState(gameState.gameId, gameState);
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to trade');
        log('warn', 'game.trade_failed', { socketId: socket.id, error: message });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: viewOf(gameState, socket.id) } });
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
        reply(ack, { ok: true, data: { gameState: gameState ? viewOf(gameState, socket.id) : null } });
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
        // Not the card or what it turned out to be: that is hidden-hand information, and nothing needs it on disk.
        log('info', 'game.card_lookup', { socketId: socket.id, gameId: parsed.gameId, secret: parsed.secret === true });
        // Only the asker sees what was found. The others are told that a lookup happened.
        announceCheat(parsed.gameId, 'lookup');
        reply(ack, { ok: true, data: { result } });
      } catch (err) {
        const message = normalizeError(err, 'Unable to look up card');
        log('warn', 'game.card_lookup_failed', { socketId: socket.id, error: message });
        reply(ack, { ok: false, error: message });
      }
    });

    socket.on('disconnect', () => {
      connectedPlayerIds.delete(socket.id);
      rateBuckets.delete(socket.id);
      // A person who was waiting to be let in and went away is no longer asking.
      for (const { gameId, request } of manager.dropJoinRequestsOf(socket.id)) {
        const host = manager.peekState(gameId)?.hostId;
        if (host) io.to(host).emit('game:joinRequestCancelled', { requestId: request.requestId });
      }
      for (const gameId of manager.markDisconnected(socket.id)) {
        rebroadcastLater(gameId, timing.noticeMs ?? 10_000);
        rebroadcastLater(gameId, timing.kickMs ?? 90_000);
        abandonLater(gameId);
      }
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
    await persistence?.stop();
    for (const timer of reconnectionTimers) clearTimeout(timer);
    for (const timer of robotTimers) clearTimeout(timer);
    await auth.stop();
    await new Promise<void>((resolve, reject) => {
      io.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  };

  return { app, io, httpServer, config, auth, manager, start: () => httpServer.listen(config.port), stop };
}

if (process.env.NODE_ENV !== 'test') {
  const server = createRealtimeServer();
  server.start();
  // Not awaited: the game accepts players while the database connects.
  void server.auth.start();
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
