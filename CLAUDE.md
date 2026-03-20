# CLAUDE.md — UpNDown Project Guide

This file is read by Claude Code at the start of every session. Keep it accurate and up-to-date.

---

## Project Overview

**UpNDown** is a cooperative card game with:
- A **Solitaire mode** (fully client-side; no server needed)
- A **Realtime multiplayer mode** (Socket.IO, server-authoritative)
- A **shared TypeScript engine** that encodes all game rules deterministically

The server never trusts the client — all game-state transitions happen in `packages/engine` and are applied by `apps/server`.

---

## Monorepo Layout

```
UpNDown/
  apps/
    client/          React + Vite + TypeScript UI
    server/          Node.js + Express + Socket.IO game server
  packages/
    engine/          Pure game rules & state transitions (no I/O)
    shared-types/    DTOs, Zod schemas, default settings (shared by client & server)
  tests/
    e2e/             Playwright smoke + accessibility tests
```

---

## Tech Stack

| Layer        | Technology                        |
|--------------|-----------------------------------|
| Client       | React 18, Vite, TypeScript        |
| Server       | Node.js 20+, Express, Socket.IO 4 |
| Game logic   | Pure TypeScript (packages/engine) |
| Shared types | Zod schemas + TS interfaces       |
| Unit tests   | Vitest                            |
| E2E tests    | Playwright + axe-core             |

---

## Key Commands

```bash
# Install
npm install

# Dev (two terminals)
npm run dev --workspace @upndown/server
npm run dev --workspace @upndown/client -- --host 127.0.0.1 --port 5173

# Test (always run before committing)
npm run test                          # all workspaces
npm run test --workspace=apps/client  # client only
npm run test --workspace=apps/server  # server only

# Type-check
npm run typecheck

# Lint
npm run lint

# Build
npm run build:client
npm run build:server
```

---

## Before Every Commit

1. **Run `npm run test`** — all tests must be green. Never commit with failing tests.
2. **Run `npm run typecheck`** — zero TypeScript errors required.
3. **Bump the version** in `apps/client/src/version.ts`:
   - Increment by **0.01** unless Ken specifies a larger jump.
   - Format: `'1.00'`, `'1.01'`, `'1.02'`, …
4. Write a clear commit message summarising *why*, not just *what*.

---

## Version Numbering

The app version lives in **one place only**:

```
apps/client/src/version.ts
```

```ts
export const APP_VERSION = '1.00';   // ← bump by 0.01 each commit
```

It is displayed in the lower-right corner of the Settings dialog. Do **not** use `package.json` version fields for display purposes — those follow npm semver conventions which are unrelated.

---

## Architecture Rules

### Shared Types (`packages/shared-types`)
All interfaces shared between client and server belong here:
- `JoinableGameSummary`, `JoinLookupSummary`
- `defaultMultiplayerSettings`, `defaultSolitaireSettings`
- All Zod payload schemas (validate at the server boundary)
- Do **not** duplicate type definitions across workspaces.

### Engine (`packages/engine`)
- **Pure functions only.** No I/O, no side effects, no `Date.now()` in hot paths.
- Exports `emptyPlayerStats()` — import from here, don't redefine it.
- All game state transitions go through `transitions.ts`.

### Server (`apps/server`)
- `game-manager.ts` — in-memory room/game state. A server restart wipes all games (v1 by design).
- `index.ts` — all Socket.IO event handlers live here. Every event must:
  1. Pass through the **rate limiter** (`checkRateLimit`)
  2. Be validated with the appropriate **Zod schema** before touching game state
  3. Respond via the **ack callback** (`ok: true | false`)
- Rate limits are defined in `eventRateLimits` at the top of `index.ts`. Every `socket.on` event must appear in that map.

### Client (`apps/client`)
- `App.tsx` is ~2,900 lines (monolithic — known tech debt). A full decomposition plan lives in `APP_DECOMPOSITION_PLAN.md`. Do **not** make it larger. When adding new UI, prefer extracting a component or hook first.
- `sounds.ts` — audio side effects only, no game logic.
- `App.css` — single stylesheet, scoped with class names. No CSS modules or Tailwind.

---

## Important Files Reference

| File | Purpose |
|------|---------|
| `apps/client/src/version.ts` | **Single source of truth** for app version |
| `apps/client/src/App.tsx` | Entire client UI (monolithic — see decomp plan) |
| `apps/client/src/App.css` | All client styles |
| `apps/client/public/how-to-play.html` | In-app "How to Play" page (linked from landing screen) |
| `apps/server/src/game-manager.ts` | In-memory game rooms + all game operations |
| `apps/server/src/index.ts` | Socket.IO server, rate limiting, event routing |
| `packages/engine/src/transitions.ts` | Card plays, turn logic, win/loss evaluation |
| `packages/engine/src/rules.ts` | Card play legality checks |
| `packages/engine/src/init.ts` | Game initialisation (deck, hands, piles) |
| `packages/shared-types/src/game-types.ts` | All shared interfaces + default settings |
| `packages/shared-types/src/schemas.ts` | Zod validation schemas for socket payloads |
| `APP_DECOMPOSITION_PLAN.md` | 8-phase plan to break up App.tsx — **plan only, no code** |
| `GAME_MECHANICS.md` | Full game rules reference — keep in sync with code |
| `requirements.md` | Feature requirements — keep in sync with implemented behaviour |
| `DEPLOYMENT.md` | Production deployment steps |
| `OPERATIONS.md` | Runtime ops (logs, restarts, env vars) |

---

## Documentation Sync Rule

Whenever a game rule, setting constraint, socket event, or player limit changes in code, **also update** `GAME_MECHANICS.md` and `requirements.md` in the same commit. These docs were rewritten in the March 2026 code-review cleanup to match the actual implementation — don't let them drift again.

---

## Multiplayer Socket Protocol

All socket events use an **acknowledgement pattern**:

```ts
// Server sends:
ack({ ok: true, data: { ... } })
// or
ack({ ok: false, error: 'Human-readable message' })

// Client checks:
if (!response.ok) { /* handle error */ }
```

Key events: `game:create`, `game:join`, `game:rejoin`, `game:listJoinable`, `game:start`, `game:playCard`, `game:endTurn`, `game:undoPlay`, `game:endGame`, `game:updateSettings`, `game:leave`, `game:kick`, `game:setReaction`, `game:cardLookup`, `game:nasCheat`.

Server-push events (no ack): `game:updated`, `game:kicked`.

---

## Game Constraints (v1)

| Setting | Value |
|---------|-------|
| Players | 2–6 (multiplayer), 1 (solitaire) |
| Hand size | 5–9 cards (default 7) |
| Card values | 2–99 (default range) |
| Min cards per turn | 2 (default) |
| State persistence | In-memory only — restart clears all games |

---

## Test Baseline

```
apps/client:  15 tests across 3 files — must all pass
apps/server:  unit + integration tests in /test — must all pass
packages/*:   unit tests — must all pass
```

If a test is non-trivially broken and cannot be fixed in the same PR, leave a `// TODO:` comment explaining why — never delete a test silently.

---

## Known Tech Debt (do not add to without discussion)

1. **`App.tsx` is ~2,900 lines.** Decomposition plan: `APP_DECOMPOSITION_PLAN.md`. Execute one phase at a time with a full test gate between phases.
2. **No persistence layer.** Server restart loses all active games. A Redis or DB layer is a future consideration.
3. **No auth/sessions.** Players are identified by a server-assigned `playerId` UUID stored in the socket. Rejoining is possible within the same server process.

---

## Commit & Push Convention

- Commit message: imperative mood, 72-char subject line, body explaining *why* if non-obvious.
- Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` when Claude made the changes.
- Always push to `origin main` after a user-approved commit.
- Never force-push to `main`.
