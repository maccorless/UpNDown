Created: 17-Nov-2026 22:41 IST

# Design: Player Profile, Statistics and Achievements (guest and signed in)

Status: APPROVED by the owner on 17-Nov-2026 with the decisions in section 15. Implementation plan: `docs/plans/2026-11-17-profile-stats-achievements-plan.md`.

Builds on `docs/design/login-and-profiles.md` (phases 1 to 5 shipped, phase 6 was the statistics page). This document replaces that phase 6 and reverses four earlier decisions (section 2).

## 1. Goal

Every player, signed in or not, has a profile page with two tabs: **Statistics** and **Achievements**. A guest's profile lives on their device. A signed-in player's lives in the database. A guest who later signs in with Google brings their device history, statistics and badges with them, intact. Nobody loses a game because of a bad connection.

Inspiration for achievements: `D10Net/docs/superpowers/specs/2026-07-14-streaks-achievements-design.md` (Bronze/Silver/Gold tiers, one-time unlocks, a pure deterministic evaluator, toasts after the result screen, a badge wall with progress). Taken: tiers, the pure evaluator, "never mid-game" toasts, progress to the next tier, a hard-breaking day streak. Left out: the daily board, the Oracle and score-window badges (UpNDown has no daily board), points or XP.

## 2. Decisions

| Topic | Decision | Replaces |
|-------|----------|----------|
| Guest history | Guests keep their finished games on the device (browser storage). | 13-Nov "Guests keep nothing" (login design, section 2) |
| Claiming earlier games | A guest's device history is moved into the Google account on sign-in, after the player agrees. | Non-goal "No claiming a guest's earlier games" (login design, section 3) |
| Lost saves | A signed-in solitaire result that cannot be sent is kept on the device and retried. | "There is no offline queue" (login design, section 4); it was deferred only because the browser did not know which account a queued result belonged to. The profile fetch answers that. |
| Where statistics are computed | One pure TypeScript function over result rows, used by the browser for guests and by the server for accounts. | Login design 9.3, which computes them in SQL. Two implementations of the same numbers would drift. |
| Achievements | Derived by a pure function over the same rows. Not stored as separate counters. | n/a |
| Tabs | Statistics and Achievements are separate tabs of one Profile page. | Login design 11 (a single statistics page) |
| Privacy | Unchanged: profile, statistics and badges are private to the owner. | n/a |

## 3. Non-goals (v1)

- No leaderboards, sharing, public profiles, rarity percentages ("3% of players have this") or friends.
- No points, XP or levels. A badge count and tier counts are the only score.
- No streak freeze. A missed day ends the day streak (as in D10Net).
- No syncing a guest profile between two devices. Signing in is the way to do that.
- No new tables. Badges are computed; the only new stored things are extra columns on `game_results` (section 6) and a "seen badges" map inside the existing settings document.
- No change to game rules.

## 4. Principles

1. **Rows are the single source of truth.** A finished game is one row. Statistics and badges are functions of the rows. Moving a guest into an account is therefore just moving rows; nothing else has to be reconciled.
2. **One UI, two sources.** The Profile page talks to a `ProfileSource` with two implementations: local (browser storage, computes in the browser) and account (HTTP, computed on the server). Same components, same tests.
3. **Idempotent everywhere.** Every row has a `game_id`. Writing the same game twice, locally or on the server, changes nothing. This is what makes retries and the guest-to-account move safe.
4. **Never lose data silently.** Local rows are deleted only after the server confirms them. Every failure leaves the data where it was and says so.

## 5. Statistics tab

Same numbers whether guest or account. Computed by `computeStats(rows, { tz, now })`.

- **Tiles:** games, win rate, time played, current win streak, current day streak, badges earned (links to the Achievements tab).
- **Totals:** games, wins, losses, abandoned, cards played, backward 10s, total movement, average movement per card, time played. Win rate is wins divided by wins plus losses; abandoned games are counted but excluded from it (as in the login design 9.3).
- **Streaks:** win streak (a win extends it; a loss or abandoned game resets it) and day streak (consecutive local calendar days with at least one finished game; a missed day resets it). Current and best of each. A day is a day in the viewing device's time zone (see section 6.3).
- **Records:** fastest win, fewest cards left in a loss, most backward 10s in one game, longest game, biggest table won.
- **Breakdowns:** by mode, by player count, by difficulty (`hand_size`, `min_cards_per_turn`, `max_card`), and by robots at the table (none, some, all).
- **Cheats:** total and per game for skip, trade, card seeker and hint.
- **Trend:** last 20 games as W, L and A letters (text, not only color), inline.
- **History:** newest first, with the settings snapshot, "Load more". For guests this is read straight from device storage; for accounts, `GET /api/me/games?cursor=`.
- **States:** empty (one message and a "Play a game" button, no tiles), loading placeholder, error with Retry, and a "N games waiting to sync" notice when the outbox (section 8.3) is not empty.
- Phone layout: breakdown table collapses to stacked rows below phone width. Light and dark. Keyboard and screen reader support as the rest of the app.

## 6. Data

### 6.1 The row

The server's `GameResultRow` (`apps/server/src/profile/result-rows.ts`) becomes the one canonical row. Its Zod schema moves to `packages/shared-types` so the browser and the server validate with the same code. Existing columns are unchanged.

Some of the new badges need facts the rows do not hold yet. They are added as **nullable** columns (expand only, per the login design 5.4; null means "not recorded", and a badge that needs a fact simply cannot be earned from an old row):

| Column | Meaning | Source | Slice |
|--------|---------|--------|-------|
| `robot_count` | Robot seats at the table | Server knows; the browser knows from the view | 1 |
| `my_undos` | Undos this player used | Needs an engine counter (new field on `PlayerStatistics`) | 2 |
| `my_reactions` | Pile marks this player placed | Needs a counter | 2 |
| `played_last_card` | This player played the card that won | Engine knows at the end of `playCard` | 2 |

Decided 17-Nov-2026: everything ships in one slice, including the engine counters. The counters are the riskiest part (they touch `packages/engine` and the undo path), so the plan builds and tests them first.

### 6.2 Local history (guests)

- One browser-storage key, `upndown.history.v1`: `{ v, profileId, createdAtMs, rows[] }`. `profileId` is a random id for this device profile. Rows are stored compactly (the settings snapshot is reduced to the fields the statistics use).
- A row is written when a game finishes. Solitaire already has the final state and `runId`. In multiplayer the guest's browser builds the row from the finished state it receives, using the same `game_id` the server would use, so the same game is never two rows. A guest who was offline when the game ended records it on rejoin, when the finished state is shown (idempotent by `game_id`).
- The host ending a game in progress records `abandoned` for that guest host, as for an account. A guest whose game ends by the 90 second robots-only rule, or who is kicked, records nothing. Accounts do get an abandoned row in those two cases, so this is a known difference between guests and accounts, accepted for v1.
- Cap: 5,000 rows. At 4,500 the profile shows a notice; at 5,000 new games still play and the notice says history is full and that signing in keeps going. Nothing is silently dropped.
- Every read and write is wrapped in `try/catch`. See section 9 for failures.

### 6.3 Time zones

Day streaks and the time-of-day badges need a local clock. Rows store UTC only. The functions take a `tz` (IANA name from the viewing device, sent as `?tz=` to the server). Shortcut: a player who travels sees day boundaries move; upgrade only if that proves to matter.

### 6.4 Trust

Local rows are client-claimed and can be edited by the player. So can solitaire results today. Nothing is public, so there is nothing to cheat for. Imported rows still pass the same schema and plausibility checks as solitaire results (cards left at most cards total, duration and turn ranges, date window), so a bad row cannot corrupt an account.

## 7. Guest to account: moving the local profile

Principle: what was on the device arrives in the account unchanged, with original dates, and no one has to do anything twice.

1. The guest signs in (full-page redirect, as today). Browser storage survives the redirect.
2. When `/api/me` answers and the device has history, a dialog appears: "Add the N games from this device to your account?" It shows the date range and the badges those games earned. Buttons: **Add to my account** and **Not now**.
   - Asked even for a brand-new account, because the device may be shared and the games may not be the signer's. Pro: no surprise merge of someone else's games. Con: one extra tap. Recommendation: ask.
3. **Add:** the browser sends rows in batches to `POST /api/me/history-import` (at most 500 rows or 256 KB a batch, validated, `ON CONFLICT (user_id, game_id) DO NOTHING`). After each batch the server confirms, and only then are those rows removed from the device. The server answers `{ inserted, duplicates, rejected }`.
4. **Settings and name:** for a new account whose settings are empty, the device's saved name and settings seed it. For an existing account the account wins. Detail to confirm against the phase 3 notes in the login design before the plan.
5. **Badges:** because they are derived from rows, they arrive with the same unlock dates. The "seen badges" map is set for everything already earned, so there is no flood of toasts.
6. **Not now:** the device history stays, is not shown while signed in, and the dialog returns on the next sign-in. After signing out the guest profile is still there.
7. **After the move,** signing out leaves the device as a fresh guest. The sign-out confirmation says: "Your history stays in your account. This device will start a new guest profile." (Only when the device history was moved.)
8. **Failure midway** (offline, server error, tab closed): rows already confirmed are gone from the device and are in the account; the rest stay on the device. The dialog is offered again on the next load with the remaining count. Running it twice cannot duplicate anything.
9. **Limits:** 6 imports a minute per user; at most 10,000 imported rows per account; row dates up to 2 years back (the solitaire window of 400 days is too short for a long-time guest).

## 8. Signed-in players

### 8.1 Endpoints

| Method and path | Purpose |
|-----------------|---------|
| `GET /api/me/stats?tz=` | `computeStats` over the user's rows. |
| `GET /api/me/achievements?tz=` | Badge list with tier, progress and unlock dates. |
| `GET /api/me/games?cursor=` | History page (already planned). |
| `POST /api/me/history-import` | Section 7. |
| `POST /api/me/solitaire-results` | Exists. Unchanged. |

Same protections as the other `/api/me` routes: session, JSON content type, canonical Origin, rate limit. The login design table in section 10 gets these rows.

Cost: stats and badges replay the user's rows on each request. At the 5,000 solitaire row cap this is milliseconds. Shortcut: no cache; add one if multiplayer history grows past tens of thousands of rows for one user.

### 8.2 Multiplayer and solitaire results

Unchanged: multiplayer rows are written by the server when a game ends; solitaire rows are posted by the browser.

### 8.3 Outbox for solitaire results

A failed `POST /api/me/solitaire-results` (offline, 5xx) puts the row in a per-user outbox in browser storage, keyed by user id. It is retried on page load, on the browser `online` event, and from the end-of-game "Try again" button. A row leaves the outbox only on a server `ok` or a permanent 4xx (which is shown once to the player as "This game could not be saved"). The 409 "history full" answer is permanent. The end-of-game text becomes "Saved to your history." or "Saved on this device, will sync when you are online." The Statistics tab says how many are waiting.

## 9. Failure behavior

| Failure | Behavior |
|---------|----------|
| Browser storage blocked (private window, policy) | Guest history is kept in memory for the tab. The profile banner says: "Your browser is blocking storage, so your stats last only until you close this tab." The game is unaffected. |
| Storage full | Same banner variant ("This device is out of storage"). Game continues. |
| Storage data corrupt (bad JSON, unknown version) | The raw value is copied to `upndown.history.v1.corrupt`, a fresh history starts, and a notice says the old history could not be read. Never overwritten silently. |
| Two tabs open | Every write re-reads storage first and merges by `game_id`; a `storage` event refreshes the open profile. |
| Server unreachable while viewing the profile (signed in) | Error state with Retry. The tiles are not guessed. |
| Server unreachable at game end (signed in) | Outbox (8.3). |
| Auth disabled (Skiff, no database) | The profile is guest-only. The sign-in warning is replaced by a neutral note: "Stats are saved on this device." |
| Database down | Auth reports disabled (login design 13), so the profile falls back to the device profile. Account rows are not shown until it returns. |
| Safari clearing site data | See the risk in section 14. |

## 10. The unsigned-in warning

A guest profile page always shows a banner above the tabs, not dismissible, with a **Sign in with Google** button:

> **Your profile lives only in this browser.** Your stats, profile and achievements will be lost if you clear your browser data, switch browser or device, or reset this device. Sign in with Google to keep them. Everything you have so far comes with you.

Plus:

- The Profile menu shows a "This device only" chip next to the guest name, and a small dot when the warning has not been read. It is a text label, not only a color.
- The warning variants: when storage is blocked the "everything comes with you" line is replaced, because sign-in is a full-page navigation that discards memory; auth disabled (neutral note, no button); storage blocked or full (section 9); history near the cap.
- A **value-moment nudge**: the first time a guest earns a badge on a device, the toast has a second line "Sign in to keep this." At most once per device per 7 days. This is a proposal, because the login design dropped an earlier nudge; the owner decides (section 15).
- Guest profile also has **Erase history on this device**, behind a confirmation dialog that names the number of games.

## 11. Profile UI

- **Entry:** a Profile button in the header for everyone. Signed in: name, Statistics, Achievements, Account, Sign out (existing seated-game disabling rules unchanged). Guest: "Guest (this device)", Statistics, Achievements, Sign in. The landing sign-in card stays.
- **Page:** a full-screen view with a Back control, opened like the Settings dialog. Top: name, a "Signed in with Google" or "This device only" label, the banner (guests), then a tablist (`role="tablist"`) with Statistics and Achievements. The Achievements tab label carries a count of unseen badges ("Achievements, 2 new").
- **Account** page (delete account) is unchanged from the login design.
- **Achievements tab:**
  - Summary line: "12 of 34 earned, 3 gold".
  - "Almost there": the three badges closest to their next tier, each with a progress bar.
  - Categories as sections (section 12). Each badge: name, one line of description, tier medal (Bronze, Silver, Gold, written out and distinguished by shape or ring count as well as color), progress "7 / 10 wins", unlock date for earned tiers. Locked badges show the Bronze goal. Secret badges show "???" and a category hint until earned.
  - Filter: All, Earned, In progress.
- **Toasts:** after the result screen renders, never mid-game. Queue one at a time. Name, tier, one line. Stay at least 4 seconds, dismissible, `role="status"`. Respects `prefers-reduced-motion` (no animation). Everything a toast says is also on the Achievements tab, so a missed toast loses nothing.
- Copy voice: warm, a little cheeky, never snarky about losing. Written with the better-writing and better-accessibility guidance at plan time.

## 12. Achievements

Tiers are Bronze, Silver, Gold unless "one-time" (a one-time badge is shown as "Earned", with no metal, and is not in the gold count; `speedrunner` is the one badge where a lower number is better). Earning Gold keeps Bronze. Thresholds live in one config object, not in the logic. "Slice" is from section 6.1. Wins and losses count only finished games; abandoned games count only where stated.

### Playing

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `first-steps` | First Steps | Finish your first game, won or lost | one-time | 1 |
| `regular` | Regular | Finished games | 10 / 50 / 250 | 1 |
| `long-haul` | Long Haul | Total time played | 1 h / 10 h / 50 h | 1 |
| `card-shark` | Card Shark | Cards played, lifetime | 100 / 1,000 / 10,000 | 1 |
| `frequent-flyer` | Frequent Flyer | Total movement, the distance your cards have traveled | 1,000 / 10,000 / 100,000 | 1 |
| `habit` | Habit | Consecutive days with a finished game | 3 / 7 / 30 | 1 |
| `made-official` | Made It Official | Sign in with Google | one-time | 1 |

### Winning (and losing gracefully)

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `up-and-away` | Up and Away | Wins | 1 / 10 / 50 | 1 |
| `hot-streak` | Hot Streak | Consecutive wins | 3 / 5 / 10 | 1 |
| `so-close` | So Close | Lose with 1 to 3 cards left (a badge for the heartbreakers) | 1 / 5 / 15 | 1 |
| `comeback-kid` | Comeback Kid | Win right after three losses in a row | one-time | 1 |
| `light-packer` | Light Packer | Win with the smallest hand (5) | 1 / 5 / 20 | 1 |
| `closer` | Closer | Play the card that wins the game | 1 / 10 / 50 | 2 |

### The backward 10

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `rewind` | Rewind | Backward 10s, lifetime | 10 / 100 / 1,000 | 1 |
| `time-machine` | Time Machine | Backward 10s in one game | 3 / 6 / 10 | 1 |

### The table

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `solo-act` | Solo Act | Win solitaire | 1 / 10 / 50 | 1 |
| `duet` | Duet | Win a 2-player game | 1 / 10 / 50 | 1 |
| `full-table` | Full Table | Win with 6 players | 1 / 5 / 20 | 1 |
| `machine-learning` | Machine Learning | Win with a robot at the table | 1 / 10 / 50 | 1 |
| `outnumbered` | Outnumbered | Win with more robots than people | one-time | 1 |

### Cheats and helpers (playful, not shameful)

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `clean-hands` | Clean Hands | Win a game where cheats were allowed and you used none | 1 / 10 / 25 | 1 |
| `over-my-shoulder` | Over My Shoulder | Hints used, lifetime | 10 / 50 / 200 | 1 |
| `swiss-army-knife` | Swiss Army Knife | Use skip, trade, card seeker and hint in one game | one-time | 1 |
| `backseat-driver` | Backseat Driver | Pile marks placed | 50 / 250 / 1,000 | 2 |
| `oops` | Oops | Undos used | 10 / 50 / 250 | 2 |
| `no-take-backs` | No Take-Backs | Win with undo allowed and never use it | one-time | 2 |

### Time and quirks

| ID | Name | Rule | B / S / G | Slice |
|----|------|------|-----------|-------|
| `night-owl` | Night Owl | Finish games between 1 and 4 am | 1 / 10 / 50 | 1 |
| `early-bird` | Early Bird | Finish games between 5 and 7 am | 1 / 10 / 50 | 1 |
| `marathon` | Marathon | Win a game that lasted more than 60 minutes | one-time | 1 |
| `speedrunner` | Speedrunner | Win in under N minutes at default settings | 3 tiers, N tuned from simulation | 1 |

### Secrets (shown as "???" until earned)

| ID | Name | Rule | Slice |
|----|------|------|-------|
| `mirror-mirror` | Mirror, Mirror | Finish a game at a palindromic clock time (12:21, 20:02) | 1 |
| `unlucky-for-some` | Unlucky for Some | Win on Friday the 13th | 1 |
| `table-flip` | Table Flip | As host, end a game after 20 or more of your cards were played | 1 |
| `ten-out-of-ten` | Perfect Ten | Win a game where exactly ten of your plays were backward 10s | 1 |

Counts: 34 badges. All thresholds above are proposals.

**Difficulty thresholds are tuned from data, not guessed.** The simulator (`npm run sim --workspace @upndown/engine`) measures win rates by table size and settings. Gold on `light-packer`, `full-table` and `time-machine` is set so it is rare but possible, using those numbers (the simulator needs two small additions, see the plan). The simulator has no human pacing, so the `speedrunner` times and the `marathon` length are judgment calls and a release decision for the owner.

**Fixing a threshold changes old results.** Because badges are derived, changing a threshold, or adding a badge, re-evaluates all past history. A player may gain tiers (nice) or, if a threshold is raised, lose one. Rule: after release, thresholds only ever go down, and new badges backfill. Backfilled badges are marked seen, with one summary toast ("3 new badges from your history").

## 13. Evaluator contract

```ts
computeStats(rows: GameResultRow[], opts: { tz: string; now: number }): ProfileStats
evaluateAchievements(rows: GameResultRow[], opts: { tz: string; now: number; signedIn: boolean }): BadgeState[]

type BadgeState = {
  id: string;
  tier: 0 | 1 | 2 | 3;        // 0 locked
  progress: { value: number; nextTarget: number | null };
  unlockedAtMs: number[];      // one per tier earned: ended_at of the row that crossed it
};
```

- Pure. No I/O, no clock reads other than `opts.now`. Rows are sorted by `(ended_at, game_id)` inside, so input order never matters.
- Lives in a new small workspace package, `@upndown/profile`, so neither `packages/engine` (game rules) nor `packages/shared-types` (DTOs) takes on logic that is not theirs. Decision to confirm in the plan (section 15).
- Unlock time is the end time of the game that crossed the threshold, so the same rows give the same dates in the browser and on the server, and after the guest move.
- "Seen" state: a map `{ badgeId: tier }` stored in the local profile (guest) or in the settings document (account, so it follows the player between devices). Toasts are the diff between `BadgeState` and the seen map.

Tests encode why: same rows in different order produce the same output (the guest move must not change badges); the same game twice does not count twice (retries); a guest's rows moved into an account produce byte-identical `BadgeState` (the central promise); a missed day ends the day streak; abandoned games do not count for win rate or `so-close`; a null column never throws and never awards a badge; raising a threshold loses a tier and lowering one gains it (documents the rule in section 12).

## 14. Risks and things to challenge

- **Guest storage is fragile, and the warning is not decoration.** Clearing site data erases it. Safari (iOS especially) can also delete a site's script-writable storage after a stretch of no visits; I have not verified the current rules, so check before the plan. Mitigation in the design: call `navigator.storage.persist()` where available, and keep the banner honest. A real fix is only signing in.
- **Local data can be edited.** Fine while profiles are private. If leaderboards or sharing ever arrive, achievements would need server-side verification of the games.
- **Two implementations of storage, one of logic.** The risk is the two `ProfileSource` implementations drifting. The shared pure functions and shared row schema contain it; the tests above are the guard.
- **Derived badges re-tier on config changes** (section 12). Simple and consistent, but it is a product rule, not a bug.
- **Badge overload.** 34 is a lot for a game this small. Cut any that read as filler during review.
- **Privacy page.** It currently says guests keep nothing. It must be updated, by the owner, before this ships: guest history is stored only in the browser and is never sent unless the player chooses to add it to an account.
- **Not verified:** the exact fields in the multiplayer view that the guest browser would build rows from, and whether the engine can cheaply count undos, marks and the winning play. Both are checked at the start of the plan.

## 15. Decisions from the owner (17-Nov-2026)

1. **Moving a guest's history:** ask first (section 7 as written).
2. **Value-moment nudge** after a guest's first badge: yes, at most once per device per 7 days.
3. **Package:** a new `@upndown/profile` workspace.
4. **Slices:** all 34 badges, including the ones that need engine counters, ship together. The "Slice" columns above are kept only to show which badges depend on the counters (2).
5. Catalog: no cuts yet. Review after the plan.

## 16. Delivery in slices (for the plan)

1. Shared row schema moved to `shared-types`; `@upndown/profile` with `computeStats` and `evaluateAchievements` and their tests; `robot_count` migration.
2. Local history store and `ProfileSource` (local), guest rows written at game end (solitaire and multiplayer), storage-failure states.
3. Profile page: header entry, tabs, Statistics tab, banner, empty, loading and error states.
4. Achievements tab, toasts, seen map.
5. Account side: `GET /api/me/stats`, `/achievements`, `/games`; the account `ProfileSource`.
6. Guest-to-account move: import endpoint, dialog, partial-failure handling, sign-out note.
7. Outbox for solitaire results.
8. (Folded in: the engine counters and new columns come first, not last. See the plan for the order.)
9. Docs: privacy page, `requirements.md`, the login design amendments, changelog row per shipped item.

## 17. Amendments needed to `login-and-profiles.md` (when this is approved)

Sections 2 (guest history), 3 (claiming), 4 (offline queue), 9.2 (outbox), 9.3 (computed in TypeScript, not SQL), 10 (new endpoints), 11 (Profile entry for guests and the tabbed page), 16 (phase 6 replaced by section 16 above).

## 18. Built, and where the build differs from the design (17-Nov-2026)

Judgment calls made during the build, for the owner to confirm:

1. **Speedrunner counts any table size**, not solitaire only. Measured with the engine's own strategy, the default solitaire deck is almost never won (0%), so a solitaire-only badge could not be earned. Standard difficulty (hand 7, 2 a turn, cards up to 99) and no cheats still apply. See `docs/plans/2026-11-17-achievement-tuning-report.md`.
2. **Time thresholds are guesses.** Speedrunner times (10, 7, 5 minutes) and the Marathon length (an hour) have no data behind them: the simulator has no human pacing. Thresholds may only go down after release.
3. **Up to five new badges are announced one by one; more than five become one "N new badges" toast.** The design said a backfill is one summary; the first game of a new player earns four or five, which deserves its own toasts.
4. **The "sign in to keep this" nudge** is one extra line on the first toast, at most once a week per device, for guests only where sign-in exists.
5. **Guest cross-tab safety is not a lock.** Each tab remembers the games it added and puts them back if another tab's write overwrote them. Upgrade to Web Locks or IndexedDB if a lost game is ever seen.
6. **The builder lives in `@upndown/profile`, not `shared-types`**, because it needs the engine. The row type and its checks are in `shared-types`.
7. **Batches are 150 rows or 80 KB**, not 250 rows: a row is about 460 bytes and the global JSON parser stops at 100 KB.
8. **Late rejoin shortcut:** a guest who rejoins after other players left records the smaller finished table (their own counters are exact).
9. **Guests get no abandoned row** when kicked or when the robots-only 90 second rule ends the game. Accounts do.
10. **Not built:** the Account page and `DELETE /api/me` (the design's phase 6 asked for them; the plan did not carry them). Account deletion is still by email, as the privacy page says.
11. **Sign-out note:** the menu says "Signing out keeps your history in your account. This device will start a new guest profile." whenever this device has ever moved games to an account, not in a separate confirmation dialog.
12. **Existing bug fixed on the way:** signed-in solitaire results sent only the old card-swap count, so every stored solitaire row has zero skips, trades, lookups and hints. New games report them; old rows cannot be repaired.
13. **The toast region is `aria-live="polite"` without `role="status"`.** The design said `role="status"`, but the app already has one status element for game announcements (and its end-to-end tests find it by that role), so a second one broke them.
14. **Unseen badges are cleared by looking.** Opening the Achievements tab marks everything shown there as seen, so the "N new" count on the tab disappears once you have looked.
