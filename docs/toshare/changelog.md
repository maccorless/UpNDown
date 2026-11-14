Created: 09-Nov-2026 19:09 CST

# Changelog

## Week of 2026-11-09

| Date | ID | Change |
|------|----|--------|
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
