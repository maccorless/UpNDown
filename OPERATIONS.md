# Operations Runbook

## Runtime Characteristics (v1)

- Multiplayer game state is in memory, and where a database is connected games being played are also saved to it (`live_games`) and restored when the server starts.
- Without a database (the Skiff version) a server restart clears active games.
- Orphaned game cleanup:
  - Lobby games with no connected players: removed after 5 minutes.
  - Active games with no connected players: removed after 30 minutes.
  - Cleanup loop runs every 60 seconds.

## Health and Logs

- Health endpoint: `GET /health`
- Structured server logs include:
  - `server.started`, `server.stopping`, `server.stopped`
  - `socket.connected`, `socket.disconnected`
  - `game.created`, `game.joined`, `game.started`, `game.ended`, `game.left`
  - `game.*_failed` error events
  - `game.orphans_reaped`

## Common Operational Checks

1. Verify service is healthy:
   - `curl https://<server-domain>/health`
2. Confirm CORS config:
   - `ALLOWED_ORIGINS` contains the exact public URL(s) of the app.
3. Confirm proxy settings:
   - `DEPLOY_TARGET` is set (`skiff` or `railway`). The client address is deliberately not logged; `test/deploy-target.test.ts` covers how each target counts proxies.
4. Validate multiplayer smoke path:
   - create -> join -> start -> play -> end turn.

## Incident Response

### Users cannot connect

1. Check server deployment status and `/health`.
2. Check server logs for `process.uncaught_exception` or repeated `game.*_failed`.
3. Verify `ALLOWED_ORIGINS` matches the URL users open (the server serves the client from the same origin).

### Users cannot join private/public lobbies

1. Check logs for `game.lookup_failed` or `game.join_failed`.
2. Validate game is in lobby and not full.
3. If lobby appears stale, verify orphan cleanup logs.

### Lost active games after restart

Expected only when no database is connected, or when it was down for the whole game. With saving on, a restarted server loads games from the database (log lines `live.loaded`, `live.active`); players rejoin from the home page ("Rejoin game") or, signed in, by opening Multiplayer. The log line `live.write_failed` means the database is not accepting saves; the page tells players. Railway starts the new deployment before it stops the old one, so the new process waits for a Postgres advisory lock (`live.lock_lost` and repeated `live.active` waits are normal during a deploy). Setting `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (about 15) gives the old process time to save its last moves.

## Graceful Shutdown

Server handles `SIGTERM` and `SIGINT`:
- stops accepting new socket traffic
- closes socket server and HTTP server
- exits cleanly

Uncaught exceptions trigger shutdown with non-zero exit.
