Created: 09-Nov-2026 19:09 CST

# Changelog

## Week of 2026-11-09

| Date | ID | Change |
|------|----|--------|
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
