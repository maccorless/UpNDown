# Deployment Guide (Railway)

This project deploys as two services from the same repo:
- `upndown-server` (Node/Socket.IO web service)
- `upndown-client` (Vite build served via preview web service)

## 1. Prerequisites

- Railway project created
- GitHub repository connected to Railway
- `main` branch protected with CI required

## 2. Server Service (`upndown-server`)

Service type: Web Service  
Root directory: repository root

Build command:

```bash
npm run build:server
```

Start command:

```bash
npm run start:server
```

Required env vars:
- `NODE_ENV=production`
- `ALLOWED_ORIGINS=https://<client-domain>`

Optional:
- `PORT` (Railway sets this automatically)

Health check path:
- `/health`

## 3. Client Service (`upndown-client`)

Service type: Web Service  
Root directory: repository root

Build command:

```bash
npm run build:client
```

Start command:

```bash
npm run start:client
```

Required env vars:
- `VITE_SOCKET_URL=https://<server-domain>`

Notes:
- `VITE_SOCKET_URL` is consumed at build time by Vite. Trigger a rebuild after changing it.
- If you later move to Railway Static Site hosting, use `apps/client/dist` as the publish directory.

## 4. Deploy Order

1. Deploy server service.
2. Copy server public URL.
3. Set `VITE_SOCKET_URL` in client service.
4. Deploy client service.
5. Set `ALLOWED_ORIGINS` on server to the exact client URL (or comma-separated list).
6. Redeploy server.

## 5. Post-Deploy Verification

1. Open client URL.
2. Create multiplayer game.
3. Open second browser/tab and join.
4. Start game and play cards.
5. Confirm `/health` returns `ok: true`.
6. Confirm server logs show structured events (`game.created`, `game.joined`, etc.).

## 6. Rollback

Use Railway "Deployments" history:
1. Select previous healthy deployment.
2. Promote rollback for affected service.
3. Validate via smoke flow.
