# App.tsx Decomposition Plan

## Problem Statement

`apps/client/src/App.tsx` is **~2,877 lines** and contains:

- **4 React components** (`GameBoard`, `SettingsDialog`, `EndGameStatisticsModal`, `App`)
- **30+ state variables** inside `App()`
- **12+ `useEffect` hooks** inside `App()`
- **~15 event-handler functions** inside `App()`
- **10+ utility/pure functions** at module level
- Inline JSX for 8+ distinct screens/views

This file does too much. It is hard to read, hard to test in isolation, hard to diff in PRs, and impossible to lazy-load. This plan breaks it into focused, independently testable units — **without changing any behaviour**.

> **This is a plan only. No code is changed by this document.**
> Execute one phase at a time, running the full test suite after each phase before merging.

---

## Target Directory Structure

```
apps/client/src/
├── App.tsx                        ← Thin shell: mode router only (~100 lines)
├── main.tsx
├── App.css
├── sounds.ts
│
├── hooks/
│   ├── useSocket.ts               ← Socket lifecycle, event listeners, rejoin
│   ├── useJoinablePoller.ts       ← Polling game:listJoinable with back-off
│   ├── usePersistence.ts          ← Read/write localStorage (settings, name, sounds)
│   ├── useViewportHeight.ts       ← --app-height CSS var + resize/orientation
│   └── usePageVisibility.ts       ← document visibilitychange → boolean
│
├── lib/
│   ├── gameId.ts                  ← normalizeGameId, readGameIdFromLocation, buildInviteLink, syncGameIdInUrl
│   ├── settings.ts                ← readPersistedSettings, writePersistedSettings, normalizeSolitaireSettings, normalizeMultiplayerSettings, validateCreateSettings
│   ├── formatting.ts              ← formatDurationLabel
│   └── presets.ts                 ← DIFFICULTY_PRESETS, detectPreset, applyPreset
│
├── components/
│   ├── GameBoard/
│   │   ├── GameBoard.tsx          ← Extract from App.tsx (no changes)
│   │   ├── FoundationPileGrid.tsx ← The pile-grid loop
│   │   ├── ReactionSlot.tsx       ← Single player reaction slot
│   │   ├── PlayersList.tsx        ← The players-panel section
│   │   ├── HandPanel.tsx          ← The hand-panel section
│   │   └── index.ts
│   │
│   ├── SettingsDialog.tsx         ← Extract from App.tsx (no changes)
│   ├── EndGameStatisticsModal.tsx ← Extract from App.tsx (no changes)
│   │
│   ├── modals/
│   │   ├── KickConfirmModal.tsx   ← Currently inline in GameBoard players panel
│   │   ├── EndGameConfirmModal.tsx← Currently inline in App render (multiplayer)
│   │   ├── NasCheatIntroModal.tsx ← Currently inline in App render
│   │   ├── HostEndedModal.tsx     ← Currently inline in App render
│   │   └── KickedModal.tsx        ← Currently inline in App render
│   │
│   └── views/
│       ├── Landing.tsx            ← Mode-selection screen (root of App when mode === null)
│       ├── SolitaireView.tsx      ← Wraps GameBoard for solitaire (owns solitaire state)
│       └── MultiplayerView.tsx    ← Manages socket, lobby, in-game for multiplayer
```

---

## What Lives Where

### `hooks/useSocket.ts`
Extracts the largest `useEffect` in App (≈lines 1212–1324).

**Inputs (props/config):**
```ts
interface UseSocketOptions {
  socketUrl: string;
  enabled: boolean;            // true only when mode === 'multiplayer'
  activeGameIdRef: RefObject<string | null>;
  previousPlayerIdRef: RefObject<string | null>;
  playerIdRef: RefObject<string | null>;
}
```

**Returns:**
```ts
interface UseSocketResult {
  socket: Socket | null;
  connectionState: ConnectionState;
  playerId: string | null;
  multiplayerState: GameState | null;
  gameReactions: ReactionState;
  specialPlayPileId: number | null;
  kickedFromGameId: string | null;
  cardLookupToast: CardLookupResult | null;
  pendingLobbyState: GameState | null;
  setPendingLobbyState: (s: GameState | null) => void;
}
```

**Responsibility:** owns `socket.connect()`, all `socket.on`/`socket.off` subscriptions, and the `game:rejoin` emission on reconnect.

---

### `hooks/useJoinablePoller.ts`
Extracts the joinable-games polling effect (≈lines 1398–1470).

**Inputs:**
```ts
interface UseJoinablePollerOptions {
  enabled: boolean;            // true when multiplayerFlow === 'join' and no active game
  isPageVisible: boolean;
  socket: Socket | null;
  connectionState: ConnectionState;
}
```

**Returns:**
```ts
{ joinableGames: JoinableGameSummary[]; loadingJoinableGames: boolean }
```

**Responsibility:** exponential back-off on failures, pause when `!isPageVisible`.

---

### `hooks/usePersistence.ts`
Extracts localStorage reads/writes.

**Returns:**
```ts
{
  persistedSettings: PersistedSettings | null;
  saveSettings: (s: PersistedSettings) => void;
  playerName: string;
  savePlayerName: (name: string) => void;
  soundsEnabled: boolean;
  saveSoundsEnabled: (val: boolean) => void;
}
```

Also mounts the `window.storage` cross-tab sync listener.

---

### `lib/gameId.ts`
Pure functions extracted from module scope — no changes to logic:
```ts
export function normalizeGameId(raw: string | null | undefined): string | null
export function readGameIdFromLocation(): string | null
export function buildInviteLink(gameId: string): string
export function syncGameIdInUrl(gameId: string | null): void
```

---

### `lib/settings.ts`
Pure functions extracted from module scope:
```ts
export function normalizeSolitaireSettings(s: GameSettings): GameSettings
export function normalizeMultiplayerSettings(s: GameSettings): GameSettings
export function readPersistedSettings(): PersistedSettings | null
export function writePersistedSettings(s: PersistedSettings): void
export function validateCreateSettings(s: GameSettings): string | null
```

---

### `lib/formatting.ts`
```ts
export function formatDurationLabel(ms: number): string
```

---

### `lib/presets.ts`
```ts
export const DIFFICULTY_PRESETS: Record<PresetName, DifficultyPreset>
export function detectPreset(s: GameSettings): PresetName | null
export function applyPreset(s: GameSettings, preset: DifficultyPreset): GameSettings
```

---

### `components/views/SolitaireView.tsx`
Owns all solitaire-specific state currently in App:
- `solitaireState`, `solitaireSelectedCardId`, `solitaireSpecialPlayPileId`
- `solitaireUndoStack`
- `solitaireConfig`, `setSolitaireConfig`

Renders `<GameBoard mode="solitaire" … />` and the solitaire settings UI.

**Props:**
```ts
interface SolitaireViewProps {
  onExit: () => void;
}
```

---

### `components/views/MultiplayerView.tsx`
Owns all multiplayer-specific state:
- Delegates socket management to `useSocket`
- Delegates joinable polling to `useJoinablePoller`
- Owns `multiplayerFlow`, `multiplayerCreateSettings`, `joinGameId`, `joinLookup`
- Renders: lobby, in-game board, all multiplayer modals

**Props:**
```ts
interface MultiplayerViewProps {
  onExit: () => void;
}
```

---

### `components/views/Landing.tsx`
The mode-selection screen shown when `mode === null`.

**Props:**
```ts
interface LandingProps {
  onSelectSolitaire: () => void;
  onSelectMultiplayer: () => void;
}
```

Contains the "Buy Me A Coffee" link, the "How to Play" link, and the support banner.

---

### `App.tsx` (after decomposition, ~100 lines)
```tsx
export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode | null>(null);
  // deep-link detection → initial mode
  return mode === null
    ? <Landing onSelectSolitaire={() => setMode('solitaire')}
               onSelectMultiplayer={() => setMode('multiplayer')} />
    : mode === 'solitaire'
      ? <SolitaireView onExit={() => setMode(null)} />
      : <MultiplayerView onExit={() => setMode(null)} />;
}
```

---

## Migration Phases

Execute each phase independently. Each phase must leave all 15 client tests **green** before proceeding.

### Phase 1 — Extract pure utilities (zero risk)
1. Create `src/lib/gameId.ts` — move 4 functions, update imports in `App.tsx`
2. Create `src/lib/settings.ts` — move 5 functions, update imports
3. Create `src/lib/formatting.ts` — move `formatDurationLabel`
4. Create `src/lib/presets.ts` — move `DIFFICULTY_PRESETS`, `detectPreset`, `applyPreset`

**Test gate**: `npm run test --workspace=apps/client` must pass.

---

### Phase 2 — Extract presentational components
1. Create `src/components/SettingsDialog.tsx` — cut from App.tsx verbatim
2. Create `src/components/EndGameStatisticsModal.tsx` — cut from App.tsx verbatim
3. Create `src/components/GameBoard/GameBoard.tsx` — cut from App.tsx verbatim
4. Update `App.tsx` imports

**Test gate**: all tests green. Also manually verify settings dialog, stats modal, and game board render correctly.

---

### Phase 3 — Extract modal sub-components (optional cosmetic split)
Split `GameBoard` further:
1. `KickConfirmModal.tsx` — the kick confirmation dialog inside players panel
2. `ReactionSlot.tsx` — single player reaction slot (`renderSlot` function)
3. `FoundationPileGrid.tsx` — the `foundationPiles.map(...)` block
4. `PlayersList.tsx` — the players-panel section
5. `HandPanel.tsx` — the hand-panel section

Each is a pure presentational component receiving props. No state or hooks.

**Test gate**: GameBoard tests still green.

---

### Phase 4 — Extract hooks
1. `src/hooks/usePageVisibility.ts` — simple visibility change listener
2. `src/hooks/useViewportHeight.ts` — `--app-height` CSS variable updater
3. `src/hooks/usePersistence.ts` — localStorage reads/writes + cross-tab sync

**Test gate**: all tests green.

---

### Phase 5 — Extract `useSocket`
This is the highest-risk phase. The large multiplayer `useEffect` in `App` becomes a custom hook.

Checklist before merging:
- [ ] Rejoin on reconnect still works
- [ ] `game:kicked` correctly nulls multiplayer state
- [ ] `game:updated` pending-lobby logic preserved (non-host, post-won state)
- [ ] Reactions, special-play flash, card-lookup toast all fire correctly
- [ ] `previousPlayerIdRef` and `activeGameIdRef` remain consistent

**Test gate**: all 15 client tests green + manual multiplayer smoke test.

---

### Phase 6 — Extract `useJoinablePoller`
Move joinable-games polling out of `App`. Verify:
- [ ] Polling pauses when page is hidden
- [ ] Exponential back-off on repeated failures
- [ ] Polling starts/stops correctly as `multiplayerFlow` changes

**Test gate**: `pauses joinable polling when tab is hidden` test still passes.

---

### Phase 7 — Introduce view components
1. Create `Landing.tsx` from existing landing JSX in App render
2. Create `SolitaireView.tsx` — lift solitaire state out of App
3. Create `MultiplayerView.tsx` — lift multiplayer state, socket wiring, flow state out of App

**Test gate**: all 15 client tests green. All existing test IDs (`mode-solitaire`, `mode-multiplayer`, `flow-host`, `flow-join`, etc.) must still be findable.

---

### Phase 8 — Slim down `App.tsx`
Replace App body with the ~20-line mode router shown above.

**Test gate**: full test suite + E2E smoke tests.

---

## What NOT to Change

- **No logic changes.** Every function, hook, and handler is moved verbatim.
- **No prop-interface changes** to `GameBoard` (it is externally tested).
- **No `data-testid` changes** — tests rely on them.
- **No CSS changes.**
- **No new dependencies.**

---

## Approximate Line-Count Targets (after all phases)

| File                            | Est. lines |
|---------------------------------|------------|
| `App.tsx`                       | ~100       |
| `views/Landing.tsx`             | ~120       |
| `views/SolitaireView.tsx`       | ~200       |
| `views/MultiplayerView.tsx`     | ~600       |
| `components/GameBoard/index.ts` | ~5         |
| `GameBoard.tsx`                 | ~380       |
| `FoundationPileGrid.tsx`        | ~130       |
| `PlayersList.tsx`               | ~110       |
| `HandPanel.tsx`                 | ~80        |
| `SettingsDialog.tsx`            | ~230       |
| `EndGameStatisticsModal.tsx`    | ~130       |
| `hooks/useSocket.ts`            | ~120       |
| `hooks/useJoinablePoller.ts`    | ~60        |
| `hooks/usePersistence.ts`       | ~60        |
| `hooks/useViewportHeight.ts`    | ~20        |
| `hooks/usePageVisibility.ts`    | ~15        |
| `lib/gameId.ts`                 | ~25        |
| `lib/settings.ts`               | ~50        |
| `lib/formatting.ts`             | ~10        |
| `lib/presets.ts`                | ~25        |
| Various modal components        | ~200 total |
| **Total**                       | **~2,670** |

The total line count stays similar — the value is in **cohesion and testability**, not compression.

---

## Success Criteria

- [ ] `npm run test --workspace=apps/client` → 15/15 tests pass
- [ ] `npm run build --workspace=apps/client` → clean build, no type errors
- [ ] E2E smoke tests pass (`tests/e2e/`)
- [ ] No file exceeds 400 lines
- [ ] Each hook/component has a single, stateable responsibility
- [ ] New unit tests can be written for each extracted hook without mocking the entire App

---

*Plan authored: 2026-03-18. Assign as a dedicated refactor sprint, not mixed with feature work.*
