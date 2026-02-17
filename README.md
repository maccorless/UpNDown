# UpNDown

UpNDown is a cooperative card game with:
- Solitaire mode (client-only)
- Realtime multiplayer mode (Socket.IO, server-authoritative)
- Shared TypeScript engine for deterministic game rules

## Tech Stack

- Client: React + Vite + TypeScript (`apps/client`)
- Server: Node.js + Express + Socket.IO (`apps/server`)
- Shared packages:
  - `packages/engine` (rules/transitions)
  - `packages/shared-types` (DTOs/schemas)
- Tests:
  - Vitest (unit/integration)
  - Playwright + axe (e2e smoke/accessibility)

## Monorepo Layout

```text
UpNDown/
  apps/
    client/
    server/
  packages/
    engine/
    shared-types/
  tests/
    e2e/
```

## Prerequisites

- Node.js 20+
- npm 10+

## Local Development

Install dependencies:

```bash
npm install
```

Start server:

```bash
npm run dev --workspace @upndown/server
```

Start client (new terminal):

```bash
npm run dev --workspace @upndown/client -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`.

## Scripts

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e:smoke`
- `npm run build`
- `npm run build:server`
- `npm run build:client`

## Environment Variables

Server (`apps/server/.env`):
- `PORT` (default `3001`)
- `NODE_ENV` (`development|test|production`)
- `ALLOWED_ORIGINS` (comma-separated origins, required in production)

Client (`apps/client/.env`):
- `VITE_SOCKET_URL` (defaults to `http://localhost:3001` when unset)

See:
- `/Users/kcorless/Documents/Projects/UpNDown/apps/server/.env.example`
- `/Users/kcorless/Documents/Projects/UpNDown/apps/client/.env.example`

## Deployment

Deployment and runtime docs:
- `/Users/kcorless/Documents/Projects/UpNDown/DEPLOYMENT.md`
- `/Users/kcorless/Documents/Projects/UpNDown/OPERATIONS.md`

## Current Production Model

- Multiplayer state is in-memory (v1). A server restart clears active games.
- Cross-tab settings persistence is localStorage-based on the client.
