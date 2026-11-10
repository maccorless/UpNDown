Created: 09-Nov-2026 19:09 CST

# Changelog

## Week of 2026-11-09

| Date | ID | Change |
|------|----|--------|
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
