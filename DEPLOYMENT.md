# Deployment Guide

One Docker image runs on both Railway and Skiff. The server also serves the built client, and the client
connects to the page's own origin, so there is no client service and no `VITE_SOCKET_URL`.
The platform is chosen with env vars on the service, not in code.

## 1. Configuration

| Variable | Required | Notes |
|----------|----------|-------|
| `DEPLOY_TARGET` | recommended | `skiff` or `railway`. Sets the default for `TRUSTED_PROXY_HOPS` (skiff `2`, railway `1`). Unset gives `0`. |
| `ALLOWED_ORIGINS` | yes | Exact public URL(s) of the app, comma-separated, e.g. `https://upndown.up.railway.app`. The server refuses to start in production without it. |
| `TRUSTED_PROXY_HOPS` | no | Overrides the `DEPLOY_TARGET` default. Number of reverse proxies in front of the server, used to find the real client IP in `X-Forwarded-For` for per-IP limits. Too high lets clients spoof their IP; too low makes users share one limit. Check the `clientIp` field of the `socket.connected` log after deploying. |
| `PORT` | no | Set by the platform. The image defaults to `8080`. |

The image already sets `NODE_ENV=production` and `CLIENT_DIST_DIR`. Health check path: `/health`.

## 2. Railway

1. Create one service from the repo. Railway detects the root `Dockerfile` and uses it, so no build or start command is needed. Do not set custom ones.
2. Generate a public domain.
3. Set `DEPLOY_TARGET=railway` and `ALLOWED_ORIGINS=https://<that-domain>`.
4. Set the health check path to `/health`.

Changing a variable redeploys the service. Rollback: Railway "Deployments" history, pick the previous healthy deployment and redeploy it.

## 3. Skiff

1. Add the component from the repo (the root `Dockerfile` is used).
2. Set variables `DEPLOY_TARGET=skiff` and `ALLOWED_ORIGINS=https://<component-url>`.
3. Skiff promotes the same image from dev to production, so set `ALLOWED_ORIGINS` separately per environment.
4. Deploy, then run `verify_deployment`.

Rollback: use the Skiff `rollback` action on the component.

## 4. Local dev

Run server and client separately (see `CLAUDE.md`). `CLIENT_DIST_DIR` is unset, so the server serves no client and Vite
serves it on `:5173`. Dev builds connect to `http://localhost:3001`.

To point a production build at a different server, set `VITE_SOCKET_URL` at build time. It is not needed on either platform.

## 5. Post-deploy verification

1. Open the app URL.
2. Create a multiplayer game.
3. Open a second browser or tab and join.
4. Start the game and play cards.
5. Confirm `/health` returns `ok: true`.
6. Confirm server logs show structured events (`game.created`, `game.joined`, etc.) and that `clientIp` on `socket.connected` is your real IP, not a proxy's.

## 6. Migrating an existing two-service Railway project

1. Point the server service at the Dockerfile build: clear its custom build and start commands.
2. Add `DEPLOY_TARGET=railway`; set `ALLOWED_ORIGINS` to the server service's public URL, the one users will now open.
3. Delete the `upndown-client` service. Old client URLs stop working.
