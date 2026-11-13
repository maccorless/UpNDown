Created: 13-Nov-2026 11:40 CST

# Design: Login, Profiles and Play History

Status: DRAFT for review. No implementation yet.

## 1. Goal

Let a player sign in with Google, or play as a guest. A signed-in player is remembered on that device, has a profile that stores their settings, and accumulates a full history of games and statistics. Guests behave exactly as today.

## 2. Decisions already made (Ken, 13-Nov-2026)

| Topic | Decision |
|-------|----------|
| Storage | Postgres through `DATABASE_URL`. Railway only. Skiff stays guest-only. |
| Login method | Server-side OAuth (authorization code flow) with our own sessions. No hosted auth vendor. |
| Providers | Google only, or guest. Facebook was dropped on 13-Nov-2026. |
| Guest history | Guests keep nothing. A new account starts with an empty history. |
| Privacy | Profile and stats are private to the owner. Other players see only the player name used in a game. |
| OAuth code | Hand-written authorization code flow with `fetch`. No OAuth library. Arctic was considered and rejected: it is deprecated as of July 2026 and marked unsupported on npm. |
| Old Railway address | GET page navigations to the `.up.railway.app` address redirect to `PUBLIC_BASE_URL` with a 302 (5.1). |
| Developer accounts | The project owner holds the Google developer account and publishes the privacy policy. |

## 3. Non-goals (v1)

- No email or password login. No other providers (Facebook, Apple, GitHub, Microsoft).
- No friends list, leaderboards, public profile pages or shared stats.
- No claiming a guest's earlier games.
- No history cap, and no record of whether a result came from the server or the browser.
- No optimistic settings versioning: settings are last write wins.
- No login on Skiff or on any host other than the canonical one (see 5.1).
- No changes to game rules, the engine, or how a game is played.

## 4. Current state that shapes the design

- Players are anonymous. `playerId` is the Socket.IO `socket.id`, which changes on every reconnect. A per-seat rejoin token maps a new socket onto an old seat (`game-manager.ts:130-170`).
- All games live in memory and a restart wipes them. There is no database and no HTTP API beyond `/health` and static files (`index.ts:177-188`).
- Solitaire runs entirely in the browser. The server never sees a solitaire game.
- The engine is pure and sets the final phase and `endedAtMs` (`transitions.ts:138-200`). Final statistics are already computed per player (`cardsPlayed`, `totalMovement`, `specialPlays`, `nasCheatsUsed`).
- Settings and player name are saved in the browser's localStorage today.
- The same Docker image runs on Railway and Skiff. Memory at idle is about 29 MB on Railway.

## 5. Architecture

```
Browser ──HTTPS──> Express (apps/server)
  |                  |-- /auth/:provider/start, /callback   (OAuth code flow)
  |                  |-- /api/auth/config, /api/me/*        (JSON, cookie session)
  |                  '-- Socket.IO (reads session cookie at handshake)
  |                          |
  |                  GameManager --(game ended, once)--> ProfileStore
  |                                                         |
  '-- remembers login: HttpOnly cookie              Postgres (Railway only)
```

### 5.1 One canonical host

OAuth redirect URIs must be registered per host, and a cookie is per host. Login works only on `PUBLIC_BASE_URL` (`https://upndown.cloud`). On any other host (the `.up.railway.app` address, localhost without config, Skiff) the server reports auth as disabled and the client hides the sign-in card. The game is unchanged there.

When `LEGACY_HOST` is set (it defaults to Railway's `RAILWAY_PUBLIC_DOMAIN` when that exists) and auth is enabled, a page navigation (a GET that accepts `text/html`) whose `Host` header exactly equals `LEGACY_HOST` is redirected with a 302 to `PUBLIC_BASE_URL` plus the original path and query, so invite links such as `/?game=ABC123` keep working and players land where login exists. The target is built by string concatenation, never by resolving the request path as a URL, and a path that does not start with a single `/` is refused. The response carries `Cache-Control: no-store` and `Vary: Host, Accept`, so a wrong rule or a wrong `PUBLIC_BASE_URL` is never pinned in a browser (a 301 would be cached indefinitely); it can be raised to a 301 once the canonical host has proven stable. The middleware is mounted before `express.static` and the single-page fallback. `/health`, API calls and sockets are never redirected, and with `LEGACY_HOST` unset nothing is redirected, which is how Skiff behaves.

### 5.2 Feature switch

Auth is enabled only when all of these are set: `DATABASE_URL`, `PUBLIC_BASE_URL`, `AUTH_STATE_SECRET`, and the Google client id and secret. If the database is unreachable at startup or later, auth reports disabled and everyone plays as a guest. The game never depends on the database.

### 5.3 New code, kept out of `App.tsx` and `index.ts`

Server (`apps/server/src/`):
- `auth/providers.ts`: a `Provider` interface (`startUrl`, `exchangeCode`, `fetchProfile`) with a Google implementation written directly against Google's documented endpoints with `fetch` and Node's `crypto` (about 100 lines, no OAuth library). Every provider request has a timeout (10 seconds), so a slow provider cannot hold a callback open. The MIT example code in the `/code` folder of the Arctic repository is a reference for the PKCE and token-exchange details, not a dependency. A fake provider for tests lives under `test/` and is injected by tests only: no environment flag or missing-credentials fallback can register it in the running server, it is never listed by `/api/auth/config`, and a test asserts both.
- `auth/sessions.ts`: create, look up, extend, revoke.
- `auth/routes.ts`: Express router for `/auth/*` and `/api/*`.
- `profile/store.ts`: `ProfileStore` interface. `PgProfileStore`, `MemoryProfileStore` (tests) and `NullProfileStore` (auth off).
- `profile/stats.ts`: SQL for aggregates.
- `db/migrate.ts` and `migrations/*.sql`.

Shared (`packages/shared-types`): DTOs and Zod schemas for `Profile`, `StoredSettings`, `StatsSummary`, `GameResultRow`.

Client (`apps/client/src/auth/`): `useAuth.ts`, `SignInCard.tsx`, `ProfileMenu.tsx`, `ProfileStats.tsx`, `AccountView.tsx`.

### 5.4 Prerequisites in the existing code

- Local development: the client runs on `:5173` and the server on `:3001`, and Vite has no proxy today. Add a Vite dev proxy for `/auth` and `/api` to `:3001` and run local login with `PUBLIC_BASE_URL=http://localhost:5173`. Cookies are shared across ports on `localhost`, so the websocket to `:3001` still receives the session cookie.
- Rate limiting: the existing helpers (`clientIpOf`, `passesRateLimit` in `index.ts`) take a Socket. HTTP routes need an equivalent that takes a request and applies `trustedProxyHops` to `X-Forwarded-For`. Verify the hop count on the `upndown.cloud` route on Railway before relying on it.
- Migrations are expand then contract: each release must work against the schema left by the previous release, because the old container keeps serving during a Railway redeploy. A column or table is removed only in a later release.

## 6. Login flow

### 6.1 Sign in

1. Client calls `GET /api/auth/config`. If `enabled` is false, show today's landing page and stop.
2. The existing landing controls (create, join, solitaire) stay exactly where they are and work as a guest with no extra tap. When auth is enabled and nobody is signed in, a compact card above them offers "Continue with Google" and a quiet line "No account needed: play as a guest below." There is no separate "Play as guest" button, so the guest path is never lengthened. A signed-in player sees "Signed in as <name>" in place of the card.
3. A provider button navigates to `GET /auth/:provider/start?return=/path`.
4. The server creates `state` and a PKCE verifier, stores them in a signed, HttpOnly, SameSite=Lax cookie `oauth_state` valid 10 minutes, and redirects to the provider. `return` is parsed with `new URL(return, PUBLIC_BASE_URL)` and accepted only when the resulting origin equals `PUBLIC_BASE_URL`, the raw value contains no backslash or control character, and it does not start with `//`. Anything else becomes `/`.
5. The provider redirects to `/auth/:provider/callback?code&state`. The server checks the cookie, state and verifier, exchanges the code, then fetches the Google user id and name.
6. Find `identities(provider, provider_user_id)`. If missing, create a user (with empty settings) and the identity in one transaction.
7. Create a session, set the cookie, clear `oauth_state`, redirect to `return`.
8. Provider tokens are used once and discarded. They are never stored.
9. A signed-in player whose settings document has no `playerName` sees the "Your name in games" step, drawn on top of the page the redirect returned to, so an invite link keeps its join context. It appears on every load until a name is saved. The field is prefilled with the name from the landing page if there is one, otherwise the Google name, and says that other players will see it. It has Continue and Skip: Continue saves, Skip saves nothing and the step returns on the next load. The name passes the existing `playerName` rule (trimmed, 1 to 32 characters) with control and bidirectional characters stripped as for guest names; if Google gives no name the field is empty with placeholder text, and an empty value cannot be saved. On a phone it is a full-screen view with one field and two buttons. This step ships with settings sync (phase 3), which provides the storage it writes to. Before then a new account plays with the landing name field.

Scope: `openid profile`. No email is requested, so none is stored.

### 6.2 Remembered on this device

- Cookie `__Host-upndown_session` in production (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`). Plain `upndown_session` in local development over http.
- The value is 32 random bytes, base64url. The database stores only its SHA-256.
- Lifetime 90 days, extended on use when more than 24 hours old, with an absolute cap of 365 days.
- On load the client calls `GET /api/me`. A valid session returns the profile and the client shows "Signed in as ..." with no click needed.
- Being a guest sets nothing. A guest who reloads is still a guest.
- Sign out revokes the session row and clears the cookie. Signing out on one device does not affect others.

### 6.3 Sockets

At the Socket.IO handshake the server reads the session cookie and sets `socket.data.userId` and `socket.data.sessionId` (or neither). `playerId` stays `socket.id`. The user id is never sent to other clients.

Sign in and sign out are offered only while the player is not seated in a lobby or game. Sign-in is a full-page redirect, so it returns on a fresh socket; the client never calls `disconnect().connect()` to apply a login, because a disconnect in a lobby removes the player from the room. Sign out revokes the session and the server clears `userId` and `sessionId` from every socket holding that session. Deleting an account closes that user's sockets. Neither can happen to a seated player through the UI, and the server clears the fields anyway so a stale socket cannot credit the wrong account.

On rejoin the seat keeps the user it was recorded with, except that a seat recorded with no user takes the rejoining socket's user. A rejoining socket with a different user, or none, is still seated by its rejoin token, and results credit the seat's recorded user. This is the same rule as 9.1.

## 7. Data model (Postgres)

```sql
users(
  id uuid primary key default gen_random_uuid(),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

identities(
  provider text not null check (provider = 'google'),
  provider_user_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, provider_user_id)
);

sessions(
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on sessions(user_id);
create index on sessions(expires_at);

game_results(
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  game_id text not null,            -- a per-run id (see 9.1), never the room code
  mode text not null check (mode in ('solitaire','multiplayer')),
  outcome text not null check (outcome in ('won','lost','abandoned')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms int not null,
  turns int not null,
  player_count int not null,
  cards_total int not null,
  cards_left int not null,
  my_cards_played int not null,
  my_total_movement int not null,
  my_special_plays int not null,
  my_nas_cheats int not null,
  hand_size int not null,
  min_cards_per_turn int not null,
  max_card int not null,
  settings jsonb not null,
  unique (user_id, game_id)
);
create index on game_results(user_id, ended_at desc);
```

Deleting a user cascades to everything. There is no soft delete.

Co-players are not stored (privacy decision): only `player_count`. The row records the team outcome and this user's own contribution.

## 8. Profile and settings

`users.settings` holds `{ playerName, solitaire, multiplayer, enableSounds }`, validated with the existing `gameSettingsSchema`.

- On login the client fetches settings. "The server has settings" means the stored document contains more than `playerName`. If it does, it replaces the local copy. If it does not, the client uploads the local settings merged with the player's `playerName` in a single `PUT /api/me/settings`. At first sign-in the name step (6.1, step 9) runs first and its confirmed name wins: the prefill uses the local landing name when one exists, otherwise the Google name.
- On change, the client sends the whole document with `PUT /api/me/settings`. The last write wins; two devices changing settings at once is rare, harmless and visible to the owner.
- Signed-out play keeps using localStorage exactly as now.
- The saved player name is `playerName` inside the settings document, set at first sign-in (6.1) and editable in the Settings dialog. The landing name field is prefilled from it; editing the field changes only that game.

## 9. Recording results and statistics

### 9.1 Multiplayer (server-authoritative)

A room code is not a game: the host can return a finished room to the lobby and start again under the same code, and a code can be reused after a room is reaped. So each start generates a fresh `runId` (a UUID) that is stored on the room and replaced on every return to the lobby. `runId` is what `game_results.game_id` holds for server-recorded rows, and the room code is never used for idempotency.

The room remembers `userIdByPlayerId` at join time and updates it on rejoin only when the rejoining socket's user matches or the seat had no user. `room.gameState` is assigned in several `GameManager` methods, but only the engine's `playCard` and `endTurn` (and `nasCheat`, if it can end a game) can produce `won` or `lost`. Those methods compare the previous and next phase and call `onGameEnded(room)` only on a `playing` to `won` or `lost` transition, so a rejoin or kick that re-assigns an already finished state cannot fire it again. The hook builds one row per seated player with a user id and passes them to `ProfileStore.recordResults`, which writes immediately. A failed write is logged once and dropped: there is no retry loop and no queue. `unique(user_id, game_id)` plus `ON CONFLICT DO NOTHING` makes it idempotent.

`recordResults` inserts one row at a time. A foreign-key failure means the user deleted their account after joining; it is permanent, so that row is logged and skipped, never retried, and never fails the other players' rows.

`ProfileStore` tracks in-flight writes, and the existing shutdown path waits for them for up to 5 seconds before the process exits. Results of games that end inside the shutdown window are best effort.

Recorded as `abandoned` through `onGameAbandoned`, which has exactly one trigger: the host calls `endGame` while the room phase is `playing`. This is the only way to leave a started game in v1, because `leaveGame` throws "Leaving during active game is not supported in v1" and `removeDisconnectedPlayer` skips rooms that are playing, so a player whose connection drops keeps their seat and nothing is recorded. Only the host who ended the game gets an `abandoned` row, because only the host chose to stop. The other players get no row: the game was cooperative, they did not quit, and nothing in their history changes. The row is built from the state before `endGame` resets the room (duration, cards played so far and cards left, the `runId`), then the room returns to the lobby with a new `runId`. `endGame` called on a finished room (`won` or `lost`), and any `leaveGame` after the game finished, record nothing, because the result is already recorded.

Not recorded: a kicked player (not their choice), a game abandoned by everyone and reaped, a game where every player drops and the room is reaped, and a lobby that never started.

### 9.2 Solitaire (client-reported)

The browser posts the final state summary to `POST /api/me/solitaire-results` with a client-generated game id. The server cannot verify a solitaire game, but because stats are private a false result only misleads its owner. The endpoint validates ranges (for example `cards_left <= cards_total`), requires `game_id` to be a UUID or at most 64 characters, passes `settings` through the existing `gameSettingsSchema` (unknown keys stripped), uses a body limit of a few KB, and rate limits per user. A result is posted once with no offline queue, so a game whose tab closes at the end is not recorded. The server sets `ended_at` to its own receive time, and rejects a client value in the future. Solitaire has no `abandoned` rows: the browser is the only witness, a closed tab can never report a quit, and a rule that records only some quits would be inconsistent.

### 9.3 Statistics shown

All computed by SQL over `game_results` for one user, never stored as counters.

- Totals: games, wins, losses, abandoned, win rate, cards played, backward 10s, net movement, average movement per card, time played. Win rate is wins divided by wins plus losses; abandoned games are listed and counted but excluded from it.
- Streaks: current and best win streak, computed over all of a user's rows ordered by `(ended_at, id)`: a win extends the streak, a loss or an abandoned game resets it. Quitting is not winning, but an abandoned game is not counted as a loss in the win rate.
- Bests: fastest win, fewest cards left in a loss, most backward 10s in one game. Abandoned rows are excluded from bests, but their partial cards played, backward 10s, movement and time are counted in the totals.
- Breakdowns: by mode, by player count, by difficulty (`hand_size`, `min_cards_per_turn`, `max_card`).
- Trend: win or loss for the last 20 games as a small inline chart.
- History: paginated list, newest first, with the settings snapshot.

### 9.4 Account linking

With Google as the only sign-in method there is nothing to link. If another provider is added later, matching by email must not be used to merge accounts, because an unverified email would allow account takeover; an explicit "link another sign-in" flow would be needed.

## 10. HTTP API

| Method and path | Purpose |
|-----------------|---------|
| `GET /api/auth/config` | `{ enabled, providers }`. Public. |
| `GET /auth/:provider/start` | Begin OAuth. |
| `GET /auth/:provider/callback` | Finish OAuth, set session. |
| `POST /api/auth/logout` | Revoke this session. |
| `GET /api/me` | Profile and settings. 401 if none. |
| `PUT /api/me/settings` | Replace settings (last write wins). |
| `GET /api/me/stats` | Aggregates. |
| `GET /api/me/games?cursor=` | History page. |
| `POST /api/me/solitaire-results` | Record a solitaire game. |
| `DELETE /api/me` | Delete the account and all data. |

State-changing routes require `Content-Type: application/json`, an `Origin` that equals `PUBLIC_BASE_URL`, and the session cookie. All routes are rate limited per IP and per user, using a request-based limiter (5.4). `express.json` gets a small body limit.

## 11. Client UI

- Landing: three states. Signed in: "Signed in as <name>" in place of the card. Guest with auth enabled: the inline sign-in card above the unchanged controls (6.1). Auth disabled: exactly today's screen. Until `/api/auth/config` and `/api/me` have both answered, show no card at all, so a returning signed-in player never sees login buttons flash. The button follows Google's sign-in branding rules.
- Header: when signed in, a profile menu with name, Statistics, Account, Sign out. While seated in a lobby or game, Account and Sign out stay in the menu but are marked `aria-disabled="true"` (they remain focusable and do nothing when activated), with a visible hint inside the menu, "Leave the game to sign out or manage your account", linked to both items with `aria-describedby`, so it is reachable on touch and by keyboard. A guest sees the landing card instead of a header link.
- Statistics and Account open as full-screen views with a visible Back control that returns to the screen the user came from, opened and closed the way the Settings dialog is.
- Profile statistics page: tiles, streaks, breakdown table, trend, history list. Light and dark themes, phone layout, keyboard and screen reader support as the rest of the app. States: empty (one message with a prompt to play, no tiles, because a new account has no history), loading placeholder, error with a Retry button, and a "Load more" button for history. The trend is a labelled list or an `aria-label` with W, L and A letters in addition to colour. Below phone width the breakdown table collapses to stacked rows.
- Account page: "Delete my account" with a confirmation dialog. The player name is edited in the Settings dialog with the other saved settings.
- The end-of-game screen shows nothing extra for a signed-in multiplayer player, because the write is not confirmed to the client. In solitaire it shows "Saved to your history" only after the save succeeds, and a quiet "Could not save this game" if it fails. A guest sees "Sign in to keep future games" when auth is enabled, because signing in later does not save the game just finished.
- Sign-in problems appear as an inline message with `role="alert"` above the sign-in card, with distinct copy: "Sign-in cancelled. You can try again, or play as a guest below." and "Sign-in did not work. Try again, or play as a guest below." The callback redirects with `?login=cancelled` (the provider returned access denied) or `?login=failed`; the client shows the message once and removes the parameter from the address.
- Static pages for the privacy policy, which includes how to delete an account, in `apps/client/public/` like `how-to-play.html`.

## 12. Security and privacy

- OAuth: authorization code flow, `state`, PKCE, exact redirect URI match, relative-only `return`, tokens discarded.
- Sessions: random 256-bit token, only its hash stored, HttpOnly, Secure, SameSite=Lax, revocable.
- CSRF: SameSite=Lax, JSON-only, Origin check on every state-changing route.
- No user id, email or provider id ever reaches other players. Only the player name used in a game does.
- Data held: provider id, settings (including the player name the player confirmed), game rows. Nothing else.
- Compliance work the code cannot do: the Google consent screen set to production, and a published privacy policy written and approved by the project owner.
- Logs never include cookies, tokens, codes or provider ids.

## 13. Failure modes

| Failure | Behaviour |
|---------|-----------|
| Database down at start | Auth disabled, guest play only. |
| Database down mid-game | Game continues. A failed result write is logged once and dropped. |
| Redeploy while a game ends | Pending result writes get up to 5 seconds at shutdown; results inside that window are best effort. |
| Provider outage or user cancels | The callback redirects to `/?login=cancelled` or `/?login=failed`; the client shows the inline message from section 11 above the card, and the game below stays usable as a guest. |
| Session expired or revoked | Treated as guest. The client shows the sign-in card. |
| Two containers during a redeploy | Migrations run under `pg_advisory_lock` and are expand then contract (5.4), so the old container keeps working against the new schema. Sessions are in the database, so either container serves the same user. |

## 14. Configuration

New variables: `DATABASE_URL`, `PUBLIC_BASE_URL`, `AUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `LEGACY_HOST`. All optional; absent means auth off or no redirect. `ALLOWED_ORIGINS` is unchanged. The pool is capped at 3 connections. Expected extra memory in the app is small; the Postgres service adds its own memory cost on Railway.

## 15. Testing

- Unit: two consecutive finished games in one room produce two rows per player, and a retried write of the same game produces one. Stats SQL fixtures for a win, win, abandoned, win sequence and for rows with equal `ended_at`. Session lifecycle, `return` path validation (including `/\evil.com`, `//evil.com` and `/%5Cevil.com`), deleting one user between join and game end still records everyone else, the fake provider is never registered or listed in production, state and PKCE checks, result row building, idempotent recording, stats SQL against fixtures.
- Provider fakes: a fake `Provider` drives the callback route without the network.
- Integration: a real Postgres in CI (GitHub Actions service container) for migrations, constraints and stats queries.
- Socket: authenticated and guest handshakes, rejoin keeps the same user, results recorded once.
- Client: sign-in card states (disabled, loading, enabled, cancelled, failed), profile menu, stats page empty, loading, error and filled, seated menu with Sign out disabled, axe checks in light and dark.
- E2E: guest flow unchanged with auth off (existing smoke tests). Signed-in flow against the fake provider.

## 16. Delivery in phases

1. Foundations: migrations, pool, `ProfileStore`, config and the auth-disabled path. No visible change.
2. Sessions and Google login, profile menu, sign out. New accounts are created with empty settings and play with the landing name field.
3. Settings sync, including `PUT /api/me/settings`, `playerName` and the "Your name in games" step.
4. Multiplayer result recording, including the host-ended `abandoned` row.
5. Solitaire result recording.
6. Statistics page, account page, and `DELETE /api/me` with its confirmation dialog.

Each phase ships behind the auth switch and leaves guest play untouched.

## 17. Open questions

None blocking. Decided on 13-Nov-2026: Google is the only provider, the old Railway address redirects (5.1), OAuth is hand-written (5.3), the project owner holds the Google developer account, a host-ended game records an `abandoned` row for the host only, and solitaire records no quits. The privacy policy text, including how to delete an account, has to be written and approved by the project owner before the Google consent screen goes to production.
