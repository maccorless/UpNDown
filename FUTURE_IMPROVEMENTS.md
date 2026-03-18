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

- `apps/client/src/App.test.tsx` and `App.multiplayer-ack.test.tsx` fail with `window is not defined` in the vitest jsdom environment — pre-existing, unrelated to feature work; needs investigation
- `tests/e2e` Playwright tests require `npx playwright install` before they can run

---

**Last updated**: 2026-03-18
