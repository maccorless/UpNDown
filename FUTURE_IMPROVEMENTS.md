# UpNDown — Backlog & Future Improvements

This document tracks what has been built and what is planned next.

---

## ✅ Recently Implemented

| Feature | Notes |
|---|---|
| Solitaire client-side engine | All solitaire logic runs in the browser; no server round-trip |
| In-memory multiplayer server | Socket.IO + in-memory game state; no database dependency |
| Undo within turn | One-card-at-a-time undo; stack clears on end turn |
| Foundation pile reactions | 👍 ❤️ 🔥 per pile; clears on your next turn start |
| Turn sequence display | Dot strip with "Your turn in X" countdown |
| Special play animation | Backward-10 triggers golden flash + floating label for all players |
| End game confirmation | Custom modal replaces browser confirm() |
| Player kick (lobby) | Host can remove players; kicked player gets a notification |
| Card lookup cheat | Ctrl-Shift-C to check if a card is in draw / in hand (who) / played; shift-enter for private result |
| Settings numeric inputs | Spinner arrows removed; plain typeable fields |
| Difficulty presets | Trivial / Easy / Normal / Hard buttons above settings grid |
| Player colours | Six distinct colours assigned by seat; shown on turn dots, player list, reactions |
| Unplayable card dim | Cards with no legal move on any pile are dimmed always, even during other players' turns |
| Sound effects | Web Audio API tones for card play, special play, turn start, win, lose; localStorage toggle |
| allowUndo actually gated | `structuredClone` snapshot now only runs when `allowUndo` is enabled in settings |
| drawOne O(1) | Replaced O(n) slice+splice with `Array.shift()` |
| Reaction memory leak fixed | `listJoinableGames` now clears `reactions` map when it reaps an orphaned room |
| holderName emitted on network | Card lookup result now includes holder's name when status is `in-hand` |
| rejoin Zod validation | `game:rejoin` handler now validates via `rejoinGamePayloadSchema` like all other events |

---

## 🗂 Active Backlog

Items below are sequenced roughly in priority / dependency order.

### 1 — Replay (Rematch)

After a game ends (win or loss), the host sees a **Replay** button. Other players see a **"Host wants a rematch!"** prompt.

- Same players, same settings, same seat order
- New server event: `game:replay` — resets game state in place without destroying the room
- Non-host players must opt in (or auto-follow — TBD)
- If a non-host declines, they are returned to the lobby screen

**Effort**: Small–Medium

---

### 2 — Peek at Hand (Cheat)

A new cheat setting: **"Peek at Hand"**.

- During a game, clicking a player's name shows their hand cards locally (your screen only)
- No server event; client reads the hand from the already-received game state
- Setting name: `allowPeekAtHand`; disabled by default; documented in how-to-play

**Effort**: Small

---

### 3 — Personal Best Tracking

Track individual solitaire and multiplayer stats in `localStorage`.

- Fewest turns to win, fastest game (seconds), lowest total card movement
- Shown in the end-game modal as "Your personal best" alongside current game stats
- No server-side persistence; purely client-local

**Effort**: Small–Medium

---

### 4 — Progressive Web App (PWA)

Make the game installable on desktop and mobile.

- `manifest.json` with app name, icons, display: standalone
- Service worker for offline shell caching (game itself needs live connection)
- "Add to Home Screen" prompt on mobile

**Effort**: Small (configuration-heavy, low code)
**Status**: Maybe — low urgency

---

## 🚫 Out of Scope / Declined

| Item | Reason |
|---|---|
| In-game chat | Removed — reactions serve the social layer; chat adds complexity |
| Leaderboards | Not planned — no persistent user identity |
| Custom card themes | Not planned — scope creep |
| Firebase / database | Fully removed; all state is in-memory |
| Firebase authentication | Removed with Firebase |
| Game history (server-side) | Not planned |

---

## 🧹 Known Tech Debt

### Code Review Findings (deferred)

These were identified in a Codex review and are valid but lower urgency than feature work:

**App.tsx decomposition** — `App.tsx` is ~2800 lines mixing domain defaults, URL state sync, localStorage, socket wiring, polling, multiplayer handlers, and several inline components. Suggested split: `useMultiplayerSocket`, `useJoinableGamesPolling`, `usePersistedSettings`, `LobbyView`, `SettingsModal`, `CardLookupModal`. Dedicated refactor session needed.

**Server entrypoint decomposition** — `index.ts` handles CORS, logging, rate limiting, all socket event wiring, and lifecycle. `game-manager.ts` handles membership, kick/rejoin/leave, reactions, room reaping, and cheat lookup. Suggested split into `socket-handlers/`, `services/game-room-service.ts`, `services/presence-service.ts`, `services/rate-limit-service.ts`.

**Shared DTOs and defaults** — `JoinableGameSummary`, `JoinLookupSummary`, `emptyPlayerStats()`, and default settings objects are duplicated across server and client. Should live in `packages/shared-types` to prevent future contract drift.

**rejoinPlayer mutation inconsistency** — `rejoinPlayer()` mutates room state in place (player IDs, host ID, stats maps, NAS/reaction maps) while all other state transitions return new objects. Low blast radius now but a maintenance risk.

**Engine clone breadth** — `playCard`, `endTurn`, and `useNasCheat` do multiple array/object copies per move. Acceptable at current scale; revisit if profiling shows GC pressure with many concurrent games.

**Horizontal scalability** — All state is process-local (no Redis, no Socket.IO adapter). A single Node process can handle hundreds of concurrent games comfortably, but multi-instance deployment would require shared state and pub/sub adapter. Not needed now.

### Other
- `apps/client/src/App.test.tsx` and `App.multiplayer-ack.test.tsx` fail with `window is not defined` in the vitest jsdom environment — pre-existing, unrelated to feature work; needs investigation
- `tests/e2e` Playwright tests require `npx playwright install` before they can run

---

**Last updated**: 2026-03-18 (post Codex review)
