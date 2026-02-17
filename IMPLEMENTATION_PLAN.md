# UpNDown Implementation Plan (v1-first, test-heavy)

## 1) Scope Baseline

This plan implements v1 only:
- Multiplayer (2-6 players)
- Solitaire (client-only)
- Foundation piles with backward-10 rule
- Configurable turn minimum (1-3), but enforced as 1 when draw pile is empty
- Configurable multiplayer auto-refill
- Anonymous join via game key
- Responsive UI from day 1

Deferred:
- v2: Undo, pile preferences
- v3: Mid-game join, durable reconnect lifecycle, host kick/recovery policy

## 2) Recommended Architecture

- Monorepo with TypeScript throughout
- Shared pure game engine package (no UI/network code)
- Web client: React + Vite
- Realtime server: Node.js + Socket.IO
- In-memory multiplayer game state for v1 (durable persistence deferred to v3)

### Proposed structure

```text
/UpNDown
  /apps
    /client            # React app
    /server            # Socket.IO server
  /packages
    /engine            # Pure game rules/state transitions
    /shared-types      # DTOs/events/settings schema
  /tests
    /e2e               # Playwright multiplayer flows
```

## 3) Staged Delivery Plan

## Stage 0: Project bootstrap + contracts

Deliverables:
- Monorepo setup (pnpm or npm workspaces)
- TypeScript, ESLint, Prettier, Vitest/Jest baseline
- Shared types for game state, settings, socket events
- JSON schema/Zod validation for settings and inbound events

Automated tests:
- Type checks in CI
- Lint in CI
- Contract tests for schema validation (valid/invalid payloads)

Exit criteria:
- CI green on lint + typecheck + contract tests

## Stage 1: Pure game engine (core rules)

Deliverables:
- Deterministic engine in `packages/engine`
- Core operations:
  - create initial state
  - validate playable card per pile
  - apply card play
  - enforce min cards/turn and draw-pile-empty override
  - turn advance and player skipping
  - win/loss evaluation
- Settings constraints:
  - Card range 2-99
  - Hand size 5-9
  - Deck size must be >= 18

Automated tests (highest priority):
- Table-driven unit tests for all rule paths
- Property-style tests (random state generation) for invariants:
  - no duplicate cards across draw+hands+piles
  - card count conservation
  - turn index always valid
  - invalid moves never mutate state
- Regression fixtures for known edge cases

Exit criteria:
- >=90% coverage in engine package
- all rule tests passing, deterministic seed reproducibility

## Stage 2: Solitaire vertical slice (client-only)

Deliverables:
- Local solitaire gameplay using engine package only
- Responsive UI implementation aligned with approved mockups
- Lobby path for solitaire game start

Automated tests:
- Component tests for key interactions (select card, play to pile, invalid action)
- Integration tests (solitaire complete win/loss scenarios)
- Visual/smoke responsive checks at mobile and desktop breakpoints

Exit criteria:
- Solitaire playable end-to-end without server
- green integration tests on desktop + mobile viewport in CI

## Stage 3: Multiplayer realtime server + client sync

Deliverables:
- Socket.IO events: create, join, start, playCard, endTurn, leave
- Server-authoritative application of engine transitions
- Room/game-key management (2-6 players)
- Client multiplayer lobby + board integration

Automated tests:
- Server integration tests for each socket event (valid/invalid/unauthorized turn)
- Multi-client sync tests (2-4 simulated clients)
- Determinism tests: same sequence of events => same final state

Exit criteria:
- two-browser manual smoke + automated multi-client tests passing
- no client-side authority bypass possible in tests

## Stage 4: UX hardening + game flow completeness

Deliverables:
- Error handling and reconnection messaging for v1 (non-durable)
- Input safeguards, disabled states, loading states
- Accessibility baseline (keyboard nav + ARIA for core controls)
- Final responsive polish for phone playability

Automated tests:
- E2E user flows in Playwright:
  - create/join/start/play/end-turn/win/loss
  - invalid move rejection messaging
  - mobile viewport usability path
- Accessibility checks (axe integration)

Exit criteria:
- stable E2E suite in CI
- no P0/P1 defects in acceptance checklist

## Stage 5: Release readiness (v1)

Deliverables:
- Deployment config and environment docs
- Observability basics (structured logs + error capture)
- Production build hardening

Automated tests:
- CI pipeline gates:
  - lint
  - typecheck
  - unit/integration tests
  - e2e smoke
- Optional nightly full e2e matrix

Exit criteria:
- reproducible deploy
- all CI gates green on protected branch

## 4) Automated Testing Strategy (Detailed)

## Test pyramid

1. Unit tests (engine-heavy, fastest)
- Target: most game correctness lives here
- Focus on pure transitions and validation

2. Integration tests
- Server socket handlers + game room lifecycle
- Client integration around state updates and error handling

3. E2E tests
- High-value multiplayer flows and mobile checks
- Keep minimal but representative to avoid flaky suite

## Suggested tooling

- Unit/integration: Vitest (or Jest) + Testing Library
- Server socket tests: socket.io-client + test server harness
- Property tests: fast-check
- E2E: Playwright
- Accessibility: @axe-core/playwright
- Coverage: c8/istanbul

## CI quality gates

- Required on every PR:
  - `lint`
  - `typecheck`
  - `test:unit`
  - `test:integration`
- Required before release:
  - `test:e2e:smoke`

## 5) Acceptance Test Matrix (v1)

Gameplay:
- Backward-10 valid on both pile types
- Normal direction invalid/valid boundaries
- Draw-pile-empty forces required minimum to 1
- Turn skip when player has no cards
- Win when all hands empty
- Loss when required plays cannot be satisfied

Settings:
- Reject invalid hand size (<5 or >9)
- Reject invalid card range outside 2-99
- Reject setup where total usable deck size <18

Multiplayer:
- Non-current player cannot play
- Out-of-order or malformed events rejected
- Joined clients receive consistent state

Responsive:
- Phone layout is fully playable
- Hand values readable for 7 and 9 cards

## 6) Milestone Order + Timeline (estimate)

- Stage 0: 1-2 days
- Stage 1: 3-5 days
- Stage 2: 3-5 days
- Stage 3: 4-6 days
- Stage 4: 2-4 days
- Stage 5: 1-2 days

Total: ~14-24 working days for a robust v1 with strong automated test coverage.

## 7) Immediate Next Steps

1. Approve tooling choices:
- package manager (`pnpm` vs `npm`)
- test runner (`Vitest` preferred)
- e2e framework (Playwright)

2. Lock shared contracts in code:
- settings schema
- socket event DTOs
- game state interfaces

3. Start Stage 0 scaffold + CI pipeline in first implementation PR.
