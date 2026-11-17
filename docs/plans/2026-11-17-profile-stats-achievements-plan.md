Created: 17-Nov-2026 23:30 IST

# Profile, Statistics and Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Profile page with Statistics and Achievements tabs for guests (data on the device) and signed-in players (data in Postgres), with an ask-first move of a guest's history into a new Google account.

**Architecture:** One canonical result row (`ResultRow`, epoch milliseconds, nullable new facts). Pure functions in a new `@upndown/profile` workspace turn rows into statistics and badges. The browser computes them for guests from device storage; the server computes them for accounts from `game_results`. The UI talks to a `ProfileSource` with a local and an account implementation. Engine counters (undos, marks, winning player) are built first because everything else depends on them.

**Tech Stack:** TypeScript, React 18, Vite, Express, Postgres (`pg`), Zod, Vitest, Playwright and axe-core.

**Spec:** `docs/design/profile-stats-achievements.md` (decisions in its section 15). Background: `docs/design/login-and-profiles.md`.

## Global Constraints

- Run `npm run typecheck` after every code change (project rule: type errors do not surface in tests).
- **Gate** (used below) = `npm run test --workspace <ws>` for each touched workspace, then `npm run typecheck`, both green.
- **Commit** (used below) = bump `APP_VERSION` in `apps/client/src/version.ts` by 0.01 (now `'1.52'`), add a row to `docs/toshare/changelog.md` (`| YYYY-MM-DD | ID or a dash | Feat: ... |` (format from the project CLAUDE.md)), commit with imperative subject of at most 72 characters and the two trailer lines from the session attribution. Commit only when Ken approves; never force-push; push to `origin main` only after an approved commit.
- No em-dashes in any user-facing text or docs. Copy is plain, warm and a little cheeky; never snarky about losing. Every color-coded thing also has a text label.
- `App.tsx` must not get longer. New UI goes into new files and hooks; `App.tsx` gets only the wiring lines.
- Every new HTTP route: session required, `resolveSession` then per-user limiter (as in `apps/server/src/auth/routes.ts`), JSON content type and `Origin === publicBaseUrl` on POST, a body size check inside the route, and a test that goes through the real middleware (`express.json()` at `apps/server/src/index.ts:225`).
- No new socket events (the `eventRateLimits` rule is untouched).
- Migrations are expand only and nullable: the old container keeps serving during a redeploy.
- All times shown to the player use the viewing device's time zone (`Intl`), passed to the server as `?tz=<IANA name>` (invalid name: 400).
- Cumulative counters (cards played, movement, backward 10s, time played, hints, pile marks, undos) include abandoned rows; `swiss-army-knife` and `table-flip` also read abandoned rows; every other badge and the win rate use finished (won or lost) rows only. Win rate = wins / (wins + losses).
- Raising a threshold after release is not allowed; thresholds only go down (spec section 12). A one-time badge reports tier 1 and is shown as "Earned" (no metal); it never counts toward the gold total.
- An unknown fact is null, never zero. Updated clients send measured values; an old client's omitted fact stays null.
- Guest storage keys: `upndown.history.v1`, `upndown.history.v1.corrupt`, `upndown.outbox.v1.<userId>`. Local row cap 5,000; notice at 4,500. Import: at most 250 rows and 90 KB per batch (the global `express.json()` limit is its 100 KB default, so no parser change), 30 a minute per user, 10,000 rows in total per account, `endedAt` at most 730 days back and 5 minutes ahead.

## Review Focus

Failure modes the spec implies that no feature test names. Each has a test in the owning task (marked in brackets).

1. A player with zero games, only abandoned games, or only old rows whose new columns are null: no `NaN`, no division by zero, no thrown error, no badge from a null fact. [T3, T4, T5]
2. Browser storage that throws, is full, or holds corrupt or newer-version JSON: play continues, nothing is overwritten silently, the corrupt copy is kept. [T8]
3. Two tabs finishing games at once, or the same game recorded twice (rejoin, retry, double click): one row. [T8, T10]
4. A tab closed or connection lost in the middle of moving history to an account: nothing lost, nothing duplicated, the offer returns. [T15]
5. Day streak edges: a game just before and just after local midnight, a daylight saving change, a device whose clock is wrong (a game dated in the future). [T3]

## File Structure

| Path | Responsibility |
|------|----------------|
| `packages/engine/src/transitions.ts`, `packages/shared-types/src/{game-types,schemas}.ts` | Counters `undosUsed`, `marksPlaced`, `statistics.finishedById`; optional `runId` in the player view |
| `packages/shared-types/src/result-row.ts` (new) | `ResultRow` type, `resultRowSchema`, `resultRowFromState` |
| `packages/profile/` (new workspace `@upndown/profile`) | `computeStats`, `evaluateAchievements`, catalog, config, time helpers. Pure, no I/O |
| `apps/server/src/db/migrations.ts`, `profile/{store,result-rows}.ts` | Migration 005, new columns, list and import methods |
| `apps/server/src/auth/routes.ts` | `GET /api/me/{stats,achievements,games}`, `POST /api/me/history-import` |
| `apps/client/src/profile/` (new) | `local-history.ts`, `outbox.ts`, `source.ts`, `useProfile.ts`, `ProfilePage.tsx`, `StatsTab.tsx`, `AchievementsTab.tsx`, `GuestBanner.tsx`, `BadgeToasts.tsx`, `MoveHistoryDialog.tsx` |
| `apps/client/src/auth/ProfileMenu.tsx` | Profile entry for guests and signed-in players |

---

### Task 1: Engine counters and the run id in the player view

**Files:**
- Modify: `packages/shared-types/src/game-types.ts` (`PlayerStatistics`, `GameStatistics`, `GameState`), `packages/shared-types/src/schemas.ts:195-220`
- Modify: `packages/engine/src/transitions.ts` (`emptyPlayerStats`, the `playCard` branch that stamps `endedAtMs` on a win), `packages/engine/src/index.ts`
- Modify: `apps/server/src/game-manager.ts` (undo at about line 597, `setReaction` at about line 180), `apps/server/src/player-view.ts`, `apps/client/src/cheats.ts:95` (`keepCheatCounts`), `apps/client/src/App.tsx:1281` (`handleSolitaireUndo`)
- Test: `packages/engine/test/profile-counters.test.ts`, `apps/server/test/` (undo and reaction counters, view), `apps/client/src/cheats.test.ts`

**Interfaces:**
- Produces: `PlayerStatistics.undosUsed: number`, `PlayerStatistics.marksPlaced: number`; `GameStatistics.finishedById?: string | null`; `GameState.runId?: string`; engine export `carryAfterUndo(restored: GameState, current: GameState, undoingPlayerId: string): GameState` (keeps every player's cheat counts and `marksPlaced` from `current`, adds 1 to the undoing player's `undosUsed` only); `toPlayerView(state, viewerId, reconnection?, runId?)`, `GameManager.runIdOf(gameId): string | null`.

- [ ] **Step 1: Write failing tests.**
  - `emptyPlayerStats()` returns `undosUsed: 0, marksPlaced: 0`.
  - `finishedById` is set only by a `playCard` that ends the game in a win (the shared `evaluateWin` is also called from `endTurn`, skip, trade and removal settlement: a test for each of those leaves it unset). A `playCard` that plays the last card of a game sets `statistics.finishedById` to that player; a game that is lost, or a play that does not end the game, leaves it null or absent.
  - `carryAfterUndo(restored, current, 'p1')` keeps the four cheat counts and `marksPlaced` from `current` for every player (another player marking between the snapshot and the undo is not lost), and returns `undosUsed` one higher than `current`'s for p1 only, while `cardsPlayed` and `totalMovement` come from `restored` (why: an undo takes the play back but not the hint, the mark or the fact that you undid).
  - Server: `undo` increments the player's `undosUsed` and keeps it after a second undo; `setReaction(..., 'love')` increments `marksPlaced`, `setReaction(..., null)` does not.
  - `gameStateSchema.parse` of a stored state with no new fields succeeds and yields zeros (a saved solitaire game or a live game from before this release must still load).
  - `toPlayerView(state, 'p1', undefined, 'run-1').runId === 'run-1'` and other hands are still hidden; the stored room state never gets a `runId`. The production call is `apps/server/src/index.ts:296` and gets the id from `manager.runIdOf`. A winner who reconnects with a new player id keeps `finishedById` (the reseating code, `swapPlayerId` near `game-manager.ts:269`, remaps it, snapshots included).
- [ ] **Step 2: Run to confirm failures.** `npm run test --workspace @upndown/engine && npm run test --workspace @upndown/server`.
- [ ] **Step 3: Implement.** Add the fields and schema defaults (`.default(0)`; `finishedById: z.string().max(100).nullable().optional()`; `runId: z.string().max(64).optional()`). Implement `carryAfterUndo` in the engine and make both undo paths call it (replacing the inline copy in `game-manager.ts` and `keepCheatCounts`, so there is not a third copy; keep `keepCheatCounts` as a thin re-export if its tests import it). In `setReaction` update `room.gameState.statistics.players[playerId].marksPlaced`. Add `runIdOf` to the manager and pass it at `index.ts:296` (and in the four calls in `apps/server/test/player-view.test.ts`). Remap `finishedById` wherever `swapPlayerId` remaps statistics keys.
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Commit** (`Add undo, mark and winning-play counters to game statistics`).

### Task 2: The canonical result row, migration 005 and server mapping

**Files:**
- Create: `packages/shared-types/src/result-row.ts` (export from `index.ts`)
- Modify: `apps/server/src/db/migrations.ts` (add `005_profile_facts`), `apps/server/src/profile/store.ts` (`GameResultRow`, insert in `recordResults`, new select), `apps/server/src/profile/result-rows.ts`, `packages/shared-types/src/schemas.ts` (`solitaireResultPayloadSchema`: add optional `undos` and `playedLastCard` with no default; undefined maps to null)
- Test: `packages/shared-types/test/result-row.test.ts`, `apps/server/test/profile-rows.test.ts` (extend the existing result-row tests)

**Interfaces:**
- Produces:
```ts
interface ResultRow {
  gameId: string; mode: 'solitaire' | 'multiplayer'; outcome: 'won' | 'lost' | 'abandoned';
  startedAtMs: number; endedAtMs: number; durationMs: number; turns: number;
  playerCount: number; robotCount: number | null;
  cardsTotal: number; cardsLeft: number; cardsPlayed: number; totalMovement: number; specialPlays: number;
  skips: number; trades: number; lookups: number; hints: number;
  undos: number | null; marks: number | null; playedLastCard: boolean | null;
  handSize: number; minCardsPerTurn: number; maxCard: number;
  cheatsAllowed: boolean; undoAllowed: boolean;
}
const resultRowSchema: z.ZodType<ResultRow>           // with the same plausibility rules as solitaireResultPayloadSchema, relaxed for abandoned
function resultRowFromState(a: { state: GameState; runId: string; outcome: ResultRow['outcome']; playerId: string; nowMs: number }): ResultRow
function cheatsAllowedBy(settings: GameSettings): boolean   // uses cheatLimitOf for the four kinds
```
  - Server: `toStoredRow(userId: string, r: ResultRow): GameResultRow` is the inverse (trades go to `myTrades`, `myNasCheats` 0; `settings` is the reduced object `{ handSize, minCardsPerTurn, minCardValue, maxCardValue, cheatsAllowed, undoAllowed }`, and `toResultRow` prefers those two booleans from stored settings when present, else derives them). Test: `toResultRow(toStoredRow(u, r))` equals `r` for imported and for server-built rows. `GameResultRow` gains `robotCount | null`, `myUndos | null`, `myReactions | null`, `playedLastCard | null`; `toResultRow(r: GameResultRow): ResultRow` (trades = `myTrades + myNasCheats`; flags from `settings`).

- [ ] **Step 1: Failing tests.** `resultRowFromState` for a 3-player game with one robot gives `playerCount 3, robotCount 1`, the player's counters, `playedLastCard` true only for `finishedById`, `cheatsAllowed` false when every cheat limit is off. `resultRowSchema` rejects: `endedAtMs < startedAtMs`, a won row with `cardsLeft > 0`, `specialPlays > cardsPlayed`, `cardsLeft > cardsTotal`; accepts an abandoned row with cards left. A row from a client that omits `undos`, `marks`, `playedLastCard` parses as nulls, and an old solitaire payload that omits `undos` yields a stored null, so `no-take-backs` is not awarded for it. Server: `buildResultRows` output equals `resultRowFromState` plus `userId` for every column the old test covered (the existing tests must pass unchanged). Migration test: the migration runs on a database that has rows and leaves them readable with nulls.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement.** Migration adds `robot_count smallint`, `my_undos int`, `my_reactions int`, `played_last_card boolean`, all nullable, no defaults. Rewrite `buildResultRows` to call `resultRowFromState` once per seated user and add `userId`/`Date` fields (one builder, not two). `buildSolitaireRow` maps the two new payload fields; solitaire `robotCount` is 0, `myReactions` 0.
- [ ] **Step 4: Gate** (shared-types, server, engine).
- [ ] **Step 5: Commit** (`Add canonical result row and profile columns`).

### Task 3: `@upndown/profile` workspace and `computeStats`

**Files:**
- Create: `packages/profile/{package.json,tsconfig.json,vitest.config.ts,eslint.config.mjs}`, `packages/profile/src/{index.ts,time.ts,stats.ts}`, `packages/profile/test/stats.test.ts`
- Modify: `tsconfig.base.json` (path `@upndown/profile`), root `package.json` (`build:server`, `build:client` build `@upndown/profile` after `@upndown/shared-types`), `apps/client/package.json` and `apps/server/package.json` (dependency `"@upndown/profile": "0.1.0"`), the aliases in `apps/server/vitest.config.ts:7` and the client's Vite and Vitest configs (`rg "upndown/engine" apps --glob '*.{ts,mjs}'`), and `package-lock.json` (run `npm install` at the root so `npm ci` in CI and the Dockerfile works; the Dockerfile copies the whole repo, so it needs no change). The package needs a `test:unit` script like `packages/engine/package.json:13`, because CI runs `npm run test:unit`
- Mirror `packages/engine` for package scripts (`build`, `typecheck`, `lint`, `test`).

**Interfaces:**
- Produces:
```ts
interface Ctx { tz: string; now: number; signedIn: boolean }
function localParts(ms: number, tz: string): { dayKey: string; hour: number; minute: number; weekday: number; day: number }  // dayKey 'YYYY-MM-DD'
function computeStats(rows: readonly ResultRow[], opts: { tz: string; now: number }): ProfileStats
interface ProfileStats {
  totals: { games: number; wins: number; losses: number; abandoned: number; winRate: number | null; cardsPlayed: number; backwardTens: number; totalMovement: number; avgMovementPerCard: number | null; timePlayedMs: number };
  streaks: { currentWin: number; bestWin: number; currentDay: number; bestDay: number };
  records: { fastestWinMs: number | null; fewestCardsLeftInLoss: number | null; mostBackwardTens: number; longestGameMs: number; biggestTableWon: number };
  breakdowns: { byMode: Slice[]; byPlayerCount: Slice[]; byDifficulty: Slice[]; byRobots: Slice[] };   // Slice = { key, label, games, wins, losses, winRate: number | null }
  cheats: { skips: number; trades: number; lookups: number; hints: number };
  trend: Array<'W' | 'L' | 'A'>;   // last 20, oldest first
}
```
- Day streak: current = the run of consecutive local days with a finished game ending today or yesterday (it is still alive until today ends); best = longest run ever.

- [ ] **Step 1: Failing tests** (`why` in each name). Input order never changes output (shuffle the same rows). The same `gameId` twice counts once. Empty rows: every number 0 or null, `trend` empty, no `NaN`. Only abandoned rows: `winRate` null, `games` equal to the abandoned count, totals still include their cards and time. Win, win, abandoned, win: `currentWin` 1, `bestWin` 2. Two games at 23:50 and 00:10 local on consecutive days: day streak 2 in `America/Chicago`, but 1 in `UTC` if both fall on one UTC day. A DST change day does not skip or double a day (`America/Chicago` on 2026-11-01). A row whose `endedAtMs` is in the future relative to `now`: counted in totals but never extends the day streak. A row with `maxCard 99, handSize 7, minCardsPerTurn 2` appears under difficulty key `7/2/99`.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement** `localParts` with a cached `Intl.DateTimeFormat` per time zone (`hourCycle: 'h23'`), dedupe and sort rows by `(endedAtMs, gameId)` once inside, then fold. Wire the workspace exactly as `@upndown/engine` is wired (`rg` results from the Files list).
- [ ] **Step 4: Gate**, plus `npm run test:unit`, then in a scratch clone `npm ci && npm run build:server && npm run build:client` to prove the lockfile and build order.
- [ ] **Step 5: Commit** (`Add the profile package with computeStats`).

### Task 4: `evaluateAchievements` framework with Playing, Winning and Backward 10 badges

**Files:**
- Create: `packages/profile/src/{achievements.ts,catalog.ts,config.ts}`, `packages/profile/test/achievements.test.ts`

**Interfaces:**
- Produces:
```ts
interface BadgeState { id: string; tier: 0 | 1 | 2 | 3; progress: { value: number; nextTarget: number | null }; unlockedAtMs: Array<number | null> }
function evaluateAchievements(rows: readonly ResultRow[], ctx: Ctx): BadgeState[]   // one entry per catalog badge, catalog order
interface Badge { id: string; name: string; blurb: string; category: Category; secret: boolean; targets: readonly number[]; fold<S>(...) }
const CATALOG: readonly Badge[]; const config: {...}   // thresholds, one object
```
  `targets` has one value for a one-time badge (tier 1 when reached, shown as "Earned" with no metal). A badge has `direction: 'atLeast' | 'atMost'`; `speedrunner` is the only `atMost` (targets descend, a smaller best time reaches a tier). `unlockedAtMs[i]` is `endedAtMs` of the row that first reached `targets[i]`; `made-official` has `null` (no date is known). Each badge is a fold over rows in `(endedAtMs, gameId)` order with a `value(state)` read after every row, so unlock times need no second pass.

- [ ] **Step 1: Failing tests.** One test per badge below that gives the smallest rows that earn Bronze, and the row that does not (name the boundary): `first-steps` (abandoned alone does not earn it); `regular` 10/50/250 finished games; `long-haul` 1 h/10 h/50 h total including an abandoned row's time; `card-shark` 100/1,000/10,000; `frequent-flyer` 1,000/10,000/100,000 movement; `habit` 3/7/30 (best run, local days, a missed day resets); `made-official` earned only when `ctx.signedIn`; `up-and-away` 1/10/50 wins; `hot-streak` 3/5/10 consecutive wins (a loss or an abandoned row resets); `so-close` 1/5/15 losses with 1 to 3 cards left (0 left is a win, 4 left does not count); `comeback-kid` a win whose three previous rows are all losses (a win, or an abandoned row, in between breaks it); `light-packer` 1/5/20 wins with `handSize === 5`; `closer` 1/10/50 wins with `playedLastCard === true` (null does not count); `rewind` 10/100/1,000 backward 10s total; `time-machine` 3/6/10 backward 10s in one finished game. Plus: output is identical for shuffled input; a duplicated `gameId` does not double count; null `robotCount`, `undos`, `marks`, `playedLastCard` never throw; appending rows newer than all existing rows never lowers a tier; unlock dates equal the `endedAtMs` of the crossing row.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement** the evaluator and these 14 badges. Names, one-line blurbs and target arrays live in `catalog.ts` and `config.ts`, copied from spec section 12 (names exactly: First Steps, Regular, Long Haul, Card Shark, Frequent Flyer, Habit, Made It Official, Up and Away, Hot Streak, So Close, Comeback Kid, Light Packer, Closer, Rewind, Time Machine).
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Commit** (`Add the achievement evaluator and the first 15 badges`).

### Task 5: Table, cheats, time and secret badges

**Files:**
- Modify: `packages/profile/src/{catalog.ts,config.ts}`; Test: `packages/profile/test/achievements-b.test.ts`

- [ ] **Step 1: Failing tests** (smallest earning row and the near miss for each): `solo-act` 1/10/50 solitaire wins; `duet` 1/10/50 wins with `playerCount 2`; `full-table` 1/5/20 wins with 6; `machine-learning` 1/10/50 wins with `robotCount >= 1`; `outnumbered` a win with more robots than people (3 players, 2 robots earns; 4 players, 2 robots does not); `clean-hands` 1/10/25 wins with `cheatsAllowed` and none of the four cheats used (undo does not matter; a win with cheats off does not count); `over-my-shoulder` 10/50/200 hints; `swiss-army-knife` one game with each of skip, trade, lookup and hint at least once; `backseat-driver` 50/250/1,000 marks; `oops` 10/50/250 undos; `no-take-backs` a win with `undoAllowed` and `undos === 0` (null `undos` does not count); `night-owl` 1/10/50 finished games ending 01:00 to 03:59 local; `early-bird` 1/10/50 ending 05:00 to 06:59 local; `marathon` a win lasting more than 60 minutes; `speedrunner` best win time with none of the four cheats used, one player and difficulty `7/2/99` (auto refill, undo and lookup settings are not in the row and are ignored: a stated shortcut), targets in `config.speedMs`, direction `atMost` (placeholder `[600_000, 420_000, 300_000]`, set in Task 6), progress shows the best time; `mirror-mirror` a finished game ending at 12:21 local (and 20:02), not 12:22; `unlucky-for-some` a win on a local Friday the 13th; `table-flip` an abandoned multiplayer row with `cardsPlayed >= 20` (19 does not); `ten-out-of-ten` a win with exactly 10 `specialPlays` (11 does not). Time-zone test: the same row is `night-owl` in `America/Chicago` and not in `UTC`.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement the 19 badges.** Secret badges have `secret: true`.
- [ ] **Step 4: Catalog integrity test:** 34 badges, unique ids, targets strictly ascending for `atLeast` and strictly descending for `atMost`, every non-secret badge has a name and a blurb of at most 90 characters, no em-dash in any string.
- [ ] **Step 5: Gate** then **Commit** (`Add the remaining achievements`).

### Task 6: Tune the difficulty thresholds from the simulator

**Files:**
- Modify: `packages/profile/src/config.ts`; Create: `docs/plans/2026-11-17-achievement-tuning-report.md`

- [ ] **Step 1:** Read `packages/engine/tools/sim.ts`. Its `play` presets and `calibrate` grid (players 1, 2, 4; hands 7, 9, 11) do not cover a hand of 5 or six players, and simulated games carry no per-game backward-10 count and no human pacing (`simulate.ts:29,45`). Add the missing configurations and the per-game backward-10 count to the sim (a small tool-only change), then measure the strategy's win rate at: hand 5 (`light-packer`), 6 players default deck (`full-table`), and the distribution of backward 10s per won game and of won-game duration at default solitaire (`time-machine`, `speedrunner`). The strategy is a proxy for a good human, not an average one: treat its win rate as an upper bound.
- [ ] **Step 2:** `speedMs` and the marathon length cannot come from the simulator (no pacing): set them by judgment, label them as such in the report, and list them as a release decision for Ken. For the others set `config` so Bronze is reachable by a casual player, Gold needs a result the strategy reaches in under about 5% of games, and write the numbers and the reasoning in the report. If a measurement still cannot be made, say so in the report and keep the placeholders; do not invent numbers.
- [ ] **Step 3: Gate; Commit** (`Tune achievement thresholds from simulated games`).

### Task 7: Server endpoints for accounts

**Files:**
- Modify: `apps/server/src/profile/store.ts` (interface and `PgProfileStore`), `apps/server/src/auth/routes.ts`; every test fake that implements `ProfileStore` (`rg "implements ProfileStore" apps/server`)
- Test: `apps/server/test/profile-routes.test.ts` (follow how the existing solitaire route tests drive the router)

**Interfaces:**
- Store: `listResults(userId: string): Promise<GameResultRow[]>`, `listResultsPage(userId: string, cursor: { endedAtMs: number; gameId: string } | null, limit: number): Promise<GameResultRow[]>` (newest first), `countAllResults(userId: string): Promise<number>`. `importResults(userId: string, rows: ResultRow[], cap: number): Promise<Array<{ gameId: string; status: 'inserted' | 'duplicate' | 'rejected'; reason?: string }>>` runs in one transaction under `pg_advisory_xact_lock` for the user: it counts the user's rows, and once the count reaches `cap` every new row is `rejected` with reason `history full`, while a row that already exists is still `duplicate`.
- Routes (all `withServices`, limiter 60 per minute per user except import 30):
  - `GET /api/me/stats?tz=` returns `{ stats: ProfileStats }`
  - `GET /api/me/achievements?tz=` returns `{ badges: BadgeState[] }`
  - `GET /api/me/games?cursor=` returns `{ rows: ResultRow[]; next: string | null }`, 50 a page, cursor `"<endedAtMs>:<gameId>"`, a malformed cursor is 400
  - `POST /api/me/history-import` body `{ rows: unknown[] }` returns `{ results: Array<{ gameId: string; status: 'inserted' | 'duplicate' | 'rejected'; reason?: string }> }`

- [ ] **Step 1: Failing tests.** 401 without a session on all four; bad `tz` is 400; stats for an account with a win and a loss match `computeStats` on the same rows; `made-official` is earned for an account and absent from the guest evaluator input; games paging returns every row exactly once across pages including two rows with the same `endedAt`; import: 3 valid rows give `inserted 3`, again gives `duplicates 3`; a row with `cardsLeft > cardsTotal` counts as `rejected` and does not stop the others; 251 rows is 400; a body over 90 KB is 413 (through the real middleware, not a direct handler call); a row dated 731 days back is rejected, a row 5 minutes and 1 second ahead is rejected; the 10,001st row is `rejected` with `history full` while a duplicate sent at capacity is still `duplicate`; two concurrent imports cannot pass the cap together; wrong `Origin` is 403; the 31st import in a minute is 429; imported rows belong only to the session user (a row cannot name another user); a row imported and then read back from `/api/me/games` equals the input.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement** with the helpers above; `resultRowSchema` validates each imported row; `toResultRow` maps stored rows; the account's own `userId` is set from the session. Call `refreshSessionCookie` like the sibling routes.
- [ ] **Step 4: Gate; Commit** (`Add stats, achievements, history and import endpoints`).

### Task 8: Local history store (guest data on the device)

**Files:**
- Create: `apps/client/src/profile/local-history.ts`; Test: `apps/client/src/profile/local-history.test.ts`

**Interfaces:**
- Produces:
```ts
interface LocalHistory {
  load(): { rows: ResultRow[]; rejected: ResultRow[]; status: 'ok' | 'memory' | 'full' | 'corrupt-reset'; profileId: string };
  add(row: ResultRow): 'added' | 'duplicate' | 'full-cap' | 'memory';
  removeConfirmed(gameIds: readonly string[]): void;
  clear(): void;                                  // "Erase history on this device"
  markRejected(gameIds: readonly string[]): void;  // rows the server refused: kept, shown, never retried automatically
  seen(): Record<string, number>; setSeen(map: Record<string, number>): void;   // seen badges, tier by id
  requestPersistence(): void;                     // navigator.storage.persist() when available
  subscribe(listener: () => void): () => void;    // storage events from other tabs
}
const createLocalHistory: (storage?: Storage) => LocalHistory   // default window.localStorage
```
  Stored JSON `{ v: 1, profileId, createdAtMs, rows, seen }`. Every mutation (`add`, `removeConfirmed`, `clear`, `setSeen`, `markRejected`) reads, merges by `gameId`, writes, then re-reads to confirm and retries up to 3 times if a row is missing (another tab wrote in between). Shortcut: this is not a lock; upgrade to Web Locks or IndexedDB if lost rows are ever seen.

- [ ] **Step 1: Failing tests** with a fake `Storage`: add then load returns the row; the same `gameId` twice is one row (`'duplicate'`); two instances sharing one storage both adding different games end with both rows, including when a fake storage injects the other instance's write between this one's `getItem` and `setItem`, for `add`, `removeConfirmed` and `clear`; storage whose `setItem` throws falls back to memory and returns `'memory'` without throwing; `QuotaExceededError` reports `status 'full'`; corrupt JSON is copied to `upndown.history.v1.corrupt`, a fresh history starts and `status` is `'corrupt-reset'`; `v: 2` data is treated as corrupt, never rewritten as `v: 1`; the 5,001st row returns `'full-cap'` and is not stored; `removeConfirmed` removes only the named ids; the `storage` event calls the subscriber.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement.** All storage calls in `try/catch`.
- [ ] **Step 4: Gate; Commit** (`Add the guest history store`).

### Task 9: Recording finished solitaire games (guest, signed in, outbox)

**Files:**
- Create: `apps/client/src/profile/outbox.ts`; Modify: `apps/client/src/useSolitaireResult.ts`, `apps/client/src/solitaire-result.ts` (`postSolitaireResult` returns `'ok' | 'retry' | 'permanent'`: a network error, 401, 429 and 5xx are `retry`; 400, 409 and 413 are `permanent`), `apps/client/src/App.tsx` (one wiring line), `apps/server/src/auth/routes.ts` (`GET /api/me` also returns `userId`), `apps/client/src/auth/useAuth.ts` (`AuthState.userId: string | null`, parsed from `/api/me`, null when signed out)
- Test: `apps/client/src/profile/outbox.test.ts`, extend `useSolitaireResult.test.tsx`, `App.solitaire-result.test.tsx`

**Interfaces:**
- `outbox.ts`: `createOutbox(userId: string, storage?: Storage): { enqueue(p: SolitaireResultPayload): void; pending(): SolitaireResultPayload[]; remove(gameId: string): void }`.
- `useSolitaireResult({ active, state, runId, signedIn, userId, history })` returns `{ status: 'idle' | 'saving' | 'saved' | 'queued' | 'failed'; retry: () => void; waiting: number }`. `buildSolitairePayload` adds `undos` and `playedLastCard` and also sends `skips`, `trades`, `lookups` and `hints` (today it sends only `nasCheats`, so signed-in solitaire rows are stored with zero cheats: an existing bug, fixed here).

- [ ] **Step 1: Failing tests.** Guest finishes a game: exactly one local row, no network call (the existing "guests make no request" test stays true). Signed in, server `ok`: status `saved`, no outbox entry. Signed in, offline: status `queued`, one outbox entry, game plays on; on the browser `online` event the entry is sent and removed. 400, 409 (`history full`) and 413: entry removed, status `failed`. 429: entry kept and retried with backoff; a backlog of 40 entries drains across the 30-a-minute limit without loss. 401: entries kept until the same `userId` is signed in again, never sent as another user. After each cheat kind is used once in a solitaire game, the guest row and the posted payload carry equal counts (Clean Hands cannot be awarded wrongly). Two sends of one `gameId` (retry button after success) produce one request result row. Outbox is keyed by user id: user B never sends user A's entries. A new page load with a non-empty outbox drains it once the user is known.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement.** Guest path writes `resultRowFromState` into `LocalHistory`. End-of-game text (in `ResultSaveStatus`, find with `rg ResultSaveStatus apps/client/src`): "Saved to your history." or "Saved on this device, will sync when you are online."
- [ ] **Step 4: Gate; Commit** (`Keep solitaire results on the device and retry failed saves`).

### Task 10: Recording finished multiplayer games for guests

**Files:**
- Create: `apps/client/src/profile/useGuestMultiplayerRecord.ts`; Modify: `apps/client/src/App.tsx` (one wiring line; the host's end-game handler, `executeEndGame` near `App.tsx:1674`, records only after the server acks)
- Test: `apps/client/src/profile/useGuestMultiplayerRecord.test.tsx`, extend `App.multiplayer-ack.test.tsx` only if a new ack path needs it

**Interfaces:**
- `useGuestMultiplayerRecord({ state: GameState | null, playerId: string | null, signedIn: boolean, history: LocalHistory }): { recordAbandoned(state: GameState): void }`. Rows use `state.runId` (Task 1) as `gameId`, so the server row for the same game later has the same id.

- [ ] **Step 1: Failing tests.** A guest's view going from `playing` to `won` writes one row for `playerId`; re-render, rejoin and a repeated `game:updated` with the same finished state write no second row; a state that arrives already `won` (rejoin after being offline) is recorded once (shortcut: if other players left before that rejoin, `playerCount`, `robotCount` and `cardsLeft` come from the smaller finished state; the guest's own counters are exact); a signed-in player records nothing locally (the server does); a view without `runId` records nothing and does not throw; the host calling `recordAbandoned` with the `playing` state writes an `abandoned` row with the cards played so far; another player in the room records nothing when the host ends the game.
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement.** Find the host's end-game handler with `rg "game:endGame" apps/client/src/App.tsx` and capture `multiplayerState` before the emit and call `recordAbandoned(captured)` only after `ack.ok`, only for a guest host and only when the captured phase is `playing`. Test: a refused or failed `game:endGame` ack records nothing, and the game's later real result is still recorded.
- [ ] **Step 4: Gate; Commit** (`Record guests' multiplayer games on the device`).

### Task 11: `ProfileSource` and `useProfile`

**Files:**
- Create: `apps/client/src/profile/{source.ts,useProfile.ts}`; Test: `apps/client/src/profile/source.test.ts`

**Interfaces:**
- ```ts
interface ProfileData { stats: ProfileStats; badges: BadgeState[]; waiting: number }
interface ProfileSource {
  kind: 'local' | 'account';
  load(tz: string): Promise<ProfileData>;
  history(cursor: string | null): Promise<{ rows: ResultRow[]; next: string | null }>;
}
function localSource(history: LocalHistory, now: () => number): ProfileSource
function accountSource(outbox: ReturnType<typeof createOutbox>, fetchImpl?: typeof fetch): ProfileSource
function useProfile(auth: AuthState): { source: ProfileSource | null; state: 'loading' | 'ready' | 'error'; data: ProfileData | null; reload: () => void }
```
  `useProfile` reads the device time zone with `Intl.DateTimeFormat().resolvedOptions().timeZone`. `auth.status` `loading` gives `source: null`.

- [ ] **Step 1: Failing tests.** Local source returns `computeStats` and `evaluateAchievements` of device rows (`signedIn: false`) and paginates history; account source calls `/api/me/stats?tz=...` and `/api/me/achievements?tz=...`, includes `waiting` from the outbox, and a non-ok response rejects (the UI shows Retry); the same rows through both sources give equal `ProfileData` (the central promise).
- [ ] **Step 2-4: Run, implement, Gate.**
- [ ] **Step 5: Commit** (`Add the profile data source`).

### Task 12: Profile page, Statistics tab, guest banner, menu entry

**Files:**
- Create: `apps/client/src/profile/{ProfilePage.tsx,StatsTab.tsx,GuestBanner.tsx}`; Modify: `apps/client/src/auth/ProfileMenu.tsx` (guest and signed-in items), `apps/client/src/App.css`, `apps/client/src/App.tsx` (open and close the page, wiring only)
- Test: `ProfilePage.test.tsx`, `StatsTab.test.tsx`, `GuestBanner.test.tsx`, extend the existing ProfileMenu test

**Interfaces:**
- `ProfilePage({ auth, source, onBack, onSignIn, storageStatus, authEnabled, locked })`. `locked` keeps the existing rule: Account and Sign out are `aria-disabled` while seated.
- `ProfileMenu` renders for guests too: label "Guest (this device)" with a visible "This device only" chip; items Profile, (Account, Sign out when signed in), Sign in (guest, only when auth is enabled).

- [ ] **Step 1: Failing tests.** Guest banner text exact: "Your profile lives only in this browser." then "Your stats, profile and achievements will be lost if you clear your browser data, switch browser or device, or reset this device. Sign in with Google to keep them. Everything you have so far comes with you." with a Sign in with Google button; it is not dismissible and absent when signed in. Auth disabled: neutral note "Stats are saved on this device." and no button. `storageStatus` `memory`: "Your browser is blocking storage, so your stats last only until you close this tab."; `full`: "This device is out of storage."; in `memory` status the sign-in promise is replaced by "Signing in will not bring this history along, because this browser cannot keep it. Games you finish after signing in are saved to your account." (sign-in is a full-page navigation that discards memory) and the sign-in button is still offered; `corrupt-reset`: a notice that the old history could not be read. Empty state: one message and a "Play a game" button, no tiles. Loading placeholder; error state with Retry that calls `reload`. Filled: tiles, breakdown table (stacked rows under phone width via CSS, asserted by class), trend rendered as W/L/A letters, history list with "Load more", "N games waiting to sync" when `waiting > 0`. Tab list has `role="tablist"`, arrow keys move between tabs, the Achievements tab label includes the count of unseen badges. "Erase history on this device" (guest only) opens a confirm dialog that names the game count; confirming calls `history.clear()`. Axe: no violations in light and dark (use the existing axe setup).
- [ ] **Step 2: Run to confirm failures.**
- [ ] **Step 3: Implement.** Use the existing `Modal` and the Settings dialog's open and close pattern. Apply the `better-accessibility` and `better-writing` skills for copy review.
- [ ] **Step 4: Gate; Commit** (`Add the profile page with statistics and the guest warning`).

### Task 13: Achievements tab

**Files:**
- Create: `apps/client/src/profile/AchievementsTab.tsx`; Modify: `App.css`; Test: `AchievementsTab.test.tsx`

- [ ] **Step 1: Failing tests.** Summary "12 of 34 earned, 3 gold" computed from `BadgeState` (gold counts only tiered badges at tier 3); "Almost there" lists the three badges with the highest `value / nextTarget` that are not finished; each badge shows name, blurb, medal as text ("Bronze", "Silver", "Gold") plus a shape that differs by tier, progress "7 / 10" with a progress element having `aria-valuenow` and a label, and the unlock date in the device time zone for earned tiers; a locked badge shows its Bronze goal; a secret badge that is locked shows "???" and its category and no name or blurb; a one-time badge shows "Earned" with no metal and does not count in the gold total; filters All, Earned, In progress change the list and keep focus on the filter; categories render as headings in the order Playing, Winning, Backward 10, Table, Cheats and helpers, Time and quirks, Secrets.
- [ ] **Step 2-4: Run, implement, Gate.**
- [ ] **Step 5: Commit** (`Add the achievements tab`).

### Task 14: Toasts, seen badges and the guest nudge

**Files:**
- Create: `apps/client/src/profile/{BadgeToasts.tsx,useBadgeToasts.ts}`; Modify: `packages/shared-types/src/schemas.ts` (`storedSettingsSchema` gains optional `seenBadges: Record<string, 1|2|3>`), `apps/client/src/auth/useAccountSync.ts` (`documentOf` includes `seenBadges`, fixed key order), `apps/client/src/App.tsx` wiring
- Test: `useBadgeToasts.test.tsx`, extend `useAccountSync` tests

**Interfaces:**
- `useBadgeToasts({ source, finishedKey, seen, setSeen, guest, history }): { toasts: Toast[]; dismiss(id: string): void }`. `finishedKey` changes when a game finishes and its save has settled (status `saved`, `queued` or a local row written). On a change it calls `source.load`, diffs `BadgeState` against `seen`, queues a toast per new tier, then `setSeen`.
- `seen` for guests lives in `LocalHistory.seen()`; for accounts in the settings document.

- [ ] **Step 1: Failing tests.** The displayed tier of a badge is the larger of the derived tier and the tier in `seen` (a badge you were shown is never taken away by a later threshold change or by an import that reorders history). No toast while a game is in progress; a new tier after a game gives one toast with name, tier and blurb; two new badges queue and show one at a time; a toast stays at least 4 seconds, is dismissible and has `role="status"`; reduced motion adds no animation class; reloading the page does not toast the same tier again; first load with 20 already-earned badges and an empty `seen` marks them seen and shows one summary toast "N badges from your history" (backfill rule); a guest's first ever badge toast has the second line "Sign in to keep this." at most once per 7 days per device, never for a signed-in player and never when auth is disabled; a failed `source.load` shows no toast and does not mark anything seen.
- [ ] **Step 2-4: Run, implement, Gate.**
- [ ] **Step 5: Commit** (`Add achievement toasts and the seen-badges record`).

### Task 15: Moving the device history into the account

**Files:**
- Create: `apps/client/src/profile/{MoveHistoryDialog.tsx,moveHistory.ts}`; Modify: `apps/client/src/auth/ProfileMenu.tsx` (sign-out note), `apps/client/src/App.tsx` wiring
- Test: `moveHistory.test.ts`, `MoveHistoryDialog.test.tsx`

**Interfaces:**
- `moveHistory(history: LocalHistory, fetchImpl?: typeof fetch): Promise<{ moved: number; remaining: number; refused: number; error: 'none' | 'offline' | 'full' | 'server' | 'rejected' }>`: sends batches of at most 250 rows and 90 KB to `POST /api/me/history-import`; per row, `inserted` and `duplicate` are removed from the device with `history.removeConfirmed`, `rejected` rows are kept and flagged with `history.markRejected` (never deleted, never retried automatically); a 429 waits and resumes).
- Dialog shown when `auth.status === 'signedIn'` and `history.load().rows.length > 0`: "Add the N games from this device to your account?" with the date range and badges they earned, buttons "Add to my account" and "Not now".

- [ ] **Step 1: Failing tests.** Add: batches of 250 for 1,200 rows (5 requests), local rows gone only after each batch's ok, `moved 1200`, `remaining 0`. Offline on batch 2: batch 1's rows are gone from the device, the rest remain, `error 'offline'`, dialog says "Your history is safe on this device" and offers Retry; calling `moveHistory` again sends only the remaining rows. Tab closed after batch 1 (simulate by constructing a new `LocalHistory` over the same storage): the offer returns with the remaining count. Running twice with the same rows duplicates nothing (`duplicate` per row). A row older than 730 days is rejected, stays on the device, and the dialog reports "1 game could not be added" with a Discard action. A 429 mid-move waits and resumes without losing rows. 409 `history full`: keeps rows, `error 'full'`, explains. "Not now": rows stay, the dialog does not return until the next page load. After a successful move the seen map is merged into the account (no toast flood) and the sign-out confirmation shows "Your history stays in your account. This device will start a new guest profile." (not shown when rows were declined). The dialog also appears for an existing account that signs in on a device with guest history, worded "These games were played on this device as a guest."
- [ ] **Step 2-4: Run, implement, Gate.**
- [ ] **Step 5: Commit** (`Move a guest's device history into the account on request`).

### Task 16: Docs, privacy page, end-to-end

**Files:**
- Modify: `apps/client/public/privacy.html`, `requirements.md`, `GAME_MECHANICS.md` (the new statistics counters), `docs/design/login-and-profiles.md` (the amendments listed in section 17 of the profile design), `docs/toshare/changelog.md`; Test: `tests/e2e/profile.spec.ts`

- [ ] **Step 1: E2E (auth off, as the existing smoke tests run).** Play a solitaire game to the end as a guest; open Profile; the Statistics tab shows 1 game; the banner is visible; a badge toast named First Steps appeared after the result screen; reload and the stats persist; the Achievements tab lists First Steps with Bronze. Axe passes on the profile page in light and dark. A signed-in flow against the fake provider: sign in with device history, accept the move dialog, stats match, sign out shows the note.
- [ ] **Step 2: Docs.** Privacy page: guest history is stored only in the browser and is sent only if the player chooses to add it to an account (the owner approves the final wording before release; leave the text in a clearly marked diff). `requirements.md`: the profile, tabs, banner, move dialog, outbox, endpoints, limits. `GAME_MECHANICS.md`: the counters `undosUsed`, `marksPlaced` and `finishedById`. Login design: amend sections 2, 3, 4, 9.2, 9.3, 10, 11 and 16 as listed.
- [ ] **Step 3: Full gate.** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build:client`, `npm run build:server`, then `npm run test:e2e:smoke`.
- [ ] **Step 4: Commit** (`Document the profile, statistics and achievements`).

---

## Self-Review

- **Spec coverage:** sections 5 (T3, T12), 6.1 (T1, T2), 6.2 (T8, T10), 6.3 (T3, T7), 6.4 (T2, T7), 7 (T15), 8.1 (T7), 8.3 (T9), 9 (T8, T12), 10 (T12, T14), 11 (T12 to T14), 12 (T4 to T6), 13 (T3 to T5, T11), 14 privacy page (T16), 16 order (changed on purpose: counters first).
- **Known deviations from the design, to approve:** `unlockedAtMs` may hold `null` (for `made-official`); one canonical row builder replaces the two server builders; `carryAfterUndo` replaces two inline copies; the design said 33 badges but its tables hold 34, so the design is corrected to 34.
- **Unverified before building:** the exact `playCard` branch that sets `endedAtMs` on a win (T1), how the existing route tests construct the router (T7), the simulator's arguments (T6), and the Vite and Docker wiring of a new workspace (T3).
- **Risks:** T1 touches the undo path in the engine, the server and the client; its tests are the guard. A threshold set from the strategy's win rate is only a proxy (T6 says so).
