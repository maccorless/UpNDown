# Operations Runbook

## Runtime Characteristics (v1)

- Multiplayer game state is in-memory.
- Server restart clears active games.
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
   - `DEPLOY_TARGET` is set (`skiff` or `railway`) and `clientIp` in `socket.connected` logs is the real client IP.
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

Expected in v1 due to in-memory storage. Communicate outage and ask players to create a new lobby.

## Graceful Shutdown

Server handles `SIGTERM` and `SIGINT`:
- stops accepting new socket traffic
- closes socket server and HTTP server
- exits cleanly

Uncaught exceptions trigger shutdown with non-zero exit.
