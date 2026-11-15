Created: 09-Nov-2026 19:09 CST

# Changelog

## Week of 2026-11-09

| Date | ID | Change |
|------|----|--------|
| 2026-11-15 | — | Feat: cheats. A cheats panel (double tap the logo, or the Cheats button), card seeker, skip and trade, each off, once per game or unlimited, set in Settings under Cheat codes. Other players are told when a cheat is used, and a card lookup is now private to the asker. Cheat use shows on the end screen and is stored with results. Replaces the Nas swap |
| 2026-11-15 | — | Feat: groundwork for cheats: per-game cheat limits (off, once, unlimited), per-player counters for skips, trades, lookups and hints, and four new columns on stored results. Feat: the How to Play page opens with a one-minute quick start |
| 2026-11-15 | — | Feat: hands of up to 11 cards (the deck is checked, so a table never gets uneven hands, and a hand of 11 fits a phone screen). Fix: the up and down arrows on the foundation piles sit midway between the card and the pile edge |
| 2026-11-15 | — | Fix: privacy page now describes the planned database saving of games in progress (what is kept, 24 hour limit, hashed rejoin tokens) and the 30 minute limit that applies today |
| 2026-11-17 | — | Feat: a signed-in account can no longer take two seats in one game; two different accounts in two tabs still can |
| 2026-11-17 | — | Feat: several tabs in one browser. A new tab always starts a fresh solitaire or multiplayer game, and saved solitaire games and seats no longer overwrite each other. The home page lists every saved solitaire game and every game in progress that no other tab has open, to continue, discard or rejoin. Starting a solitaire game no longer discards a saved one |
| 2026-11-16 | — | Feat: the home page shows "Rejoin game ABC123" next to Multiplayer when this browser still has a seat in a game being played; the seat is no longer taken back automatically |
| 2026-11-16 | — | Feat: coming back to a live game after the browser was closed. The seat is kept in the browser and taken back on its own when the page opens again; signed-in players are put back by account (including from another device) when they open multiplayer. A refused rejoin now says whether the seat is gone or the refusal is temporary |
| 2026-11-15 | — | Fix: privacy page now says the application does not log IP addresses, names Railway and Cloudflare as the parties that may, states how long data and sessions are kept, and covers games recorded as left when a player is removed |
| 2026-11-15 | — | Feat: dropped connections in a live game. After 10 seconds the others are told who is reconnecting; after 90 seconds the host can kick them or keep waiting; if the host is gone, the next available player can kick the old host and take over as host. A kick in a live game counts as a quit for the kicked player, and hands are topped up and the game re-checked after a kick |
| 2026-11-15 | — | Feat: a connection is in one game at a time: starting or joining another leaves a lobby or finished game it was still in, and is refused with a clear message while a game is being played. At most 500 rooms exist at once, the lobby list shows the 50 newest, and a signed-in account can save at most 5,000 solitaire games |
| 2026-11-15 | — | Fix: security updates to the server's dependencies: Express 4.22.3 and Socket.IO 4.8.3 with the patched ws, engine.io, socket.io-parser, body-parser, qs, path-to-regexp and proxy-addr. Production advisories drop from 10 to 1 (zod, which needs a major upgrade, left for later) |
| 2026-11-15 | — | Fix: hardening from an independent review: a solitaire game left open for weeks no longer fails to save (the stored length is capped at 24 days); names taken into a game are cleaned of control and bidirectional characters; unknown API paths answer a JSON 404 instead of the page; responses carry basic security headers; a stuck database cannot hold up new connections (they join as guests after 1.5 s); socket messages are limited to 16 KB; a card lookup no longer logs the card or its result; the Google client secret files are excluded from container builds |
| 2026-11-15 | — | Fix: the per-address rate limits could be dodged by sending your own X-Forwarded-For when fewer proxies were in front of the server than expected (the direct platform address). The connection itself is used in that case. One shared function now does this for both sockets and web routes |
| 2026-11-15 | — | Fix: opening the lobby list could delete a started game whose players had all dropped at once, so nobody could rejoin it and no result was written. Only the timed cleanup removes rooms now (5 minutes for an empty lobby, 30 for a game). A room's reactions are also freed when its last player leaves |
| 2026-11-14 | — | Change: the client's IP address is no longer written to the application log (it was recorded once per socket connection). It is still used, in memory only, for rate limits |
| 2026-11-14 | — | Feat: solitaire saves your game on this device: leave mid-game and the landing offers "Continue solitaire" (cards left, when it was saved) with your exact hand, piles and undo history. Starting over asks first. The save is removed when you win, lose or press End Game, and never leaves your browser |
| 2026-11-14 | — | Feat: solitaire needs no connection. The only things it ever sends are sign-in and, when a signed-in player finishes a game, its result, saved to their history once ("Saved to your history.", or Try again if it could not be sent). Guests and games ended early send nothing |
| 2026-11-14 | — | Docs: privacy page now has a "Games in progress" section: what is kept while a game runs (names, hands, piles, settings, turn, rejoin tokens, which account holds a seat), that it is in memory today and may move to the database, when it is deleted, and that there is no move-by-move record |
| 2026-11-14 | — | Feat: signed-in players' multiplayer games are recorded (win or loss, or an abandoned game for the host who ends a live one) with their own counters, game length and settings. Guests are not recorded. Recording never slows or breaks play, never writes a game twice, and a redeploy waits up to 5 seconds for writes in flight |
| 2026-11-14 | — | Feat: first sign-in asks for your player name ("Input your player name or accept a random one"): editable field, shuffle for another random name, a preview of how others will see you, Continue. Existing accounts are asked once; "Change name" on the landing reopens it |
| 2026-11-14 | — | Feat: new landing screen: big Up/Down wordmark in pile colours, tagline, two mode cards showing a pile of numbers, and a sign-in strip that says why to sign in. Entrance plays once per page load, never under reduced motion |
| 2026-11-14 | — | Fix: at 320px the multiplayer header clipped the Settings button; the header now wraps. Also: buttons use the page font, placeholder text meets contrast, How to Play looks like a control, the join-screen Join button is the primary action, the public games list has an accessible name, and the name field says it is a name to browsers |
| 2026-11-14 | — | Fix: an invite link no longer joins a first-time visitor under a name they never saw; they get the join screen with the name filled in. Typing a name no longer joins the game on the first letter |
| 2026-11-14 | — | Feat: new players get a random president name ("Donald Washington"); in a game it shows as "Donald W". Players can type their own |
| 2026-11-14 | — | Feat: in multiplayer a name already taken in the game gets -1, -2 and so on, compared as shown and ignoring case |
| 2026-11-14 | — | Feat: signed-in players keep their name, solitaire and multiplayer settings and sounds on the account, synced across devices (PUT /api/me/settings, 30 saves a minute per user) |
| 2026-11-14 | — | Feat: the Settings button is iced over, with frost and icicles, whenever settings are view only |
| 2026-11-14 | — | Feat: optional Google sign-in (phase 2): "Continue with Google" card on the landing screen, a profile menu with Sign out (locked while in a game), 90-day remembered login, server-side sessions, rate-limited sign-in routes, and the signed-in user attached to the socket. Guests are unchanged. Old-address redirect is built but stays off until LEGACY_HOST is set |
| 2026-11-14 | — | Feat: login groundwork (phase 1, no visible change): Postgres connection, schema migrations for users, sessions and game results, and GET /api/auth/config. Login stays off unless all five settings are present and the database answers; the game never depends on it |
| 2026-11-14 | — | Feat: privacy policy (privacy.html) and terms of service (tos.html) pages, needed for the Google consent screen; .gitignore now excludes Google OAuth client_secret downloads |
| 2026-11-13 | — | Docs: design for Google login, guest play, remembered sessions, profile settings and play history (docs/design/login-and-profiles.md); reviewed twice, no code yet |
| 2026-11-13 | — | Feat: end-of-game redesign: win splash with confetti (off when reduced motion is on), hero banner, stat tiles, "most backward 10s" callout, per-player bars with colour dots, "so close" wording only for near misses; works in dark theme |
| 2026-11-13 | — | Fix: Total Movement counts a backward 10 as -10 (it added +10), so it equals how far the piles ended from their starts |
| 2026-11-13 | — | Fix: Railway accepts sockets from the server's own .up.railway.app address (was rejected by CORS); removed the dead client domain from ALLOWED_ORIGINS |
| 2026-11-13 | — | Feat: a refused CORS origin is now logged by name (cors.origin_rejected), so a wrong domain can be told from a bot |
| 2026-11-13 | — | Feat: on desktop the foundation pile cards are the same size as the cards in your hand (one shared size variable); phones unchanged |
| 2026-11-13 | — | Feat: play sounds for everyone: golf clap for a move of 1, groan for a jump over 20, cheer for a backward 10 (replaces the old blip); other players' plays now tick too |
| 2026-11-13 | — | Feat: turn progress ("1 of 2 played") beside Your Hand for the active player, so a disabled End Turn explains itself |
| 2026-11-13 | — | Feat: a pile gets a gold ring and a "−10" or "+10" badge when the selected card would be a backward 10 there |
| 2026-11-13 | — | Feat: foundation pill shows cards left to play and fills as the deck is played down |
| 2026-11-13 | — | Feat: reaction circles carry a ring in the reacting player's colour (hover for the name) |
| 2026-11-13 | — | Feat: tab title shows "(Your turn)" when it is your turn; your turn also vibrates on phones when sound effects are on |
| 2026-11-13 | — | Feat: Settings dialog redesigned (grouped, presets with Custom state, segmented hand size and turn minimum, highest-card slider, visible help text, sticky Save/Discard, read-only summary for non-hosts); minimum players is fixed at 2 |
| 2026-11-13 | — | Fix: Settings number fields could not be cleared or retyped (every keystroke was clamped); lowest card is now a typeable Advanced field with an inline error |
| 2026-11-13 | — | Fix: pile reaction numbers, your own slot, turn dots and the "You're next" label meet 4.5:1 contrast (your own slot measured 1.5 to 2.3:1) |
| 2026-11-13 | — | Feat: dark theme follows the system setting; all overlays use native dialogs (focus containment, Esc, focus return); visible focus ring, press feedback, reduced-motion safe animations, dvh modal heights |
| 2026-11-13 | — | Fix: Pile arrows can now be changed in Solitaire (the old Settings disabled it, although the board honours it) |
| 2026-11-12 | — | Chore: removed the two-service Railway leftovers (start:client script, Vite preview allowedHosts, VITE_SOCKET_URL runbook steps) |
| 2026-11-12 | — | Feat: DEPLOY_TARGET=skiff\|railway sets the default TRUSTED_PROXY_HOPS (2 or 1); the Dockerfile no longer bakes it in, and Railway now runs the same single-container image |
| 2026-11-09 | — | Feat: single-container Skiff deploy (server serves built client, Dockerfile, Skiff skills) |
| 2026-11-10 | — | Fix: a non-function ack argument no longer crashes the server and wipes all games |
| 2026-11-10 | — | Fix: seat takeover via game:rejoin now requires a per-seat rejoin token (rotated on use) |
| 2026-11-10 | — | Fix: undo snapshots are recorded only for accepted plays and capped at 100 |
| 2026-11-10 | — | Fix: players receive only their own hand; other hands and the draw pile are hidden server-side, secret card lookup answered by the server |
| 2026-11-10 | — | Fix: CI pinned to ubuntu-24.04 (ubuntu-latest became 26.04, which Playwright 1.58.2 cannot install on) |
| 2026-11-10 | — | Feat: CI moved to ubuntu-26.04; Playwright upgraded 1.58.2 to 1.65.0, which supports it |
| 2026-11-10 | — | Fix: game:join and game:lookup return one generic "not available" message for missing, started and full games, so ids cannot be probed |
| 2026-11-10 | — | Feat: connection log now records the resolved client IP (to verify TRUSTED_PROXY_HOPS behind ALB and APISIX on Skiff) |
| 2026-11-10 | — | Test: e2e tests for hidden hands over the socket and reconnect with the rejoin token (run in CI as @smoke); undo cap unit test |
| 2026-11-10 | — | Fix: game ids use crypto.randomInt; game:lookup and game:join are also rate limited per client IP (TRUSTED_PROXY_HOPS=2 on Skiff) |
| 2026-11-10 | — | Fix: pile labels, reaction slots and settings version text meet WCAG AA contrast; pile labels 10-11px on phones (were 7-9px) |
| 2026-11-10 | — | Fix: connection indicator is announced to screen readers; in-game players list is keyboard reachable |
| 2026-11-10 | — | Feat: reaction slots sit in a row above (players 1-3) and below (players 4-6) each pile card on all widths; pile tags and rule hints removed |
| 2026-11-10 | — | Feat: one arrow on each side of each pile card (up for ascending, down for descending); Show pile arrows setting per game, default on |
