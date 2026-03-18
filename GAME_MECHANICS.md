# Up-N-Down — Game Mechanics and Implementation Guide

## Game Overview
Up-N-Down is a cooperative card game where players work together to play all cards from their hands onto four foundation piles. The game features unique ascending and descending rules with a special "backward-10" move that adds strategic depth.

**Game Modes:**
- **Multiplayer**: 2–6 players, turn-based cooperative play
- **Solitaire**: Single player, continuous play for practice and solo challenge

---

## Core Game Mechanics

### Foundation Piles

The game features **4 foundation piles** with distinct placement rules:

#### Ascending Piles (2 piles)
- **Starting value**: 1 (or `minCardValue - 1`)
- **Normal play**: Card must be higher than the current top card
- **Special play**: Card exactly 10 lower than the current top card

**Example**: If pile shows 67
- ✅ Valid: Any card 68–99 (normal ascending)
- ✅ Valid: 57 (67 − 10, backward-10 rule)
- ❌ Invalid: Any card < 57 or 58–66

#### Descending Piles (2 piles)
- **Starting value**: 100 (or `maxCardValue + 1`)
- **Normal play**: Card must be lower than the current top card
- **Special play**: Card exactly 10 more than the current top card

**Example**: If pile shows 34
- ✅ Valid: Any card 2–33 (normal descending)
- ✅ Valid: 44 (34 + 10, backward-10 rule)
- ❌ Invalid: Any card > 44 or 35–43

### The "Backward-10" Rule

This special move is crucial for strategic play and recovery from difficult situations:

**Purpose**: Allows playing in the opposite direction by exactly 10 points
**When to use**:
- When piles are "stuck" close together
- To create opportunities for other players
- As a last resort to avoid game loss

**Statistics tracking**: Backward-10 moves are counted as "special plays" in game statistics.

### Card Distribution

**Configurable parameters** (set by host in game settings):
- Card range: Default 2–99 (configurable)
- Hand size: Default 7 cards (configurable, UI range 5–9)
- Min cards per turn: Default 2 (configurable, range 1–3)
- Draw pile: Contains all remaining cards after initial deal

**Default configurations**:
- Multiplayer (2–6 players): 7 cards per player, no auto-refill
- Solitaire: 7 cards in hand, auto-refill always on

---

## Game Flow

### Multiplayer Mode

#### 1. Game Setup
1. Host creates game and receives a unique 6-character game ID
2. Other players join using the game ID (or a shareable invite link)
3. Host configures settings (optional)
4. Host starts game

#### 2. Turn Structure
**Each turn consists of**:
1. Player plays at least the minimum required cards (default: 2)
2. For each card played:
   - Select card from hand
   - Click a valid foundation pile
   - Card moves to the pile top
   - Hand auto-refills after each play (if `autoRefillHand` is enabled and draw pile has cards)
3. Player clicks "End Turn" button
4. At turn end (if `autoRefillHand` is disabled) player draws replacement cards up to hand size
5. Turn advances to next player

**Undo functionality** (requires `allowUndo: true`):
- Players can undo plays back to the beginning of their current turn, one at a time
- Cannot undo after clicking "End Turn" (stack clears on end-turn)
- Undo is server-authoritative in multiplayer; client-side in solitaire
- Statistics are automatically rolled back

**Minimum cards per turn**:
- **Normal stage** (draw pile has cards): `minCardsPerTurn` (default 2)
- **Final stage** (draw pile empty): 1 card minimum
- Players may always play more than the minimum

**Auto-refill behavior** (configurable via `autoRefillHand`):
- **Enabled**: Draw immediately after playing each card
- **Disabled** (default): Draw all replacement cards at end of turn

#### 3. Player Order
- Turn-based, sequential rotation
- Players whose hands are empty are automatically skipped
- Game continues until all players empty their hands or no valid moves exist

#### 4. Win/Loss Detection
**Win condition**: All players have empty hands
**Loss condition**: Current player cannot satisfy the minimum card requirement and has no legal plays

Game automatically checks for valid moves and declares win/loss after every card play and turn transition.

---

### Solitaire Mode

**Differences from multiplayer**:
- No turns — continuous play
- No minimum card requirement enforced
- `autoRefillHand` always `true`
- Play as many cards as possible
- Perfect for learning game mechanics
- No pile reactions (not needed in solo play)
- Undo stack is client-side only

---

### Pile Reactions (Multiplayer Only)

During other players' turns, non-active players can mark their preferences for each foundation pile to help coordinate team play.

**How it works**:
1. Click your reaction slot beside any pile (only available when it is NOT your turn)
2. Cycles: **None** → **Like** (👍) → **Love** (❤️) → **Really Love** (🔥) → **None**
3. Your reactions clear automatically when YOUR turn starts
4. All players see everyone's reactions in real time

**Player slot positions**:
- Left column: Players 1–3 (by join order)
- Right column: Players 4–6 (by join order)

---

## Implementation Details

### Technology Stack
- **Frontend**: React with TypeScript, Vite
- **Backend**: Node.js with Express
- **Real-time**: Socket.IO for multiplayer synchronisation
- **State storage**: In-memory (`Map<string, GameRoom>`) with TTL-based orphan reaping
- **Styling**: CSS with dark theme

### Monorepo Layout
```
packages/
  engine/          Pure game-logic functions (playCard, endTurn, …)
  shared-types/    TypeScript interfaces + Zod schemas shared by client & server
apps/
  client/          React + Vite frontend (App.tsx)
  server/          Express + Socket.IO backend (index.ts, game-manager.ts)
tests/e2e/         Playwright smoke tests
```

### Game State Management

#### Server (Single Source of Truth)
```typescript
interface GameState {
  gameId: string;
  hostId: string;
  players: Player[];
  foundationPiles: FoundationPile[];
  drawPile: Card[];
  currentPlayerIndex: number;
  gamePhase: 'lobby' | 'playing' | 'won' | 'lost';
  cardsPlayedThisTurn: number;
  statistics: GameStatistics;
  nasCheat: NasCheatState;
  settings: GameSettings;
  isSolitaire: boolean;
}
```

#### Player State
```typescript
interface Player {
  id: string;
  name: string;
  hand: Card[];
  isHost: boolean;
  color?: PlayerColor;   // 'red' | 'orange' | 'green' | 'cyan' | 'purple' | 'pink'
}
```

#### Foundation Pile State
```typescript
interface FoundationPile {
  id: number;
  type: 'ascending' | 'descending';
  topCard: Card;   // Only the top card is stored; history is not kept
}
```

#### Game Settings
```typescript
interface GameSettings {
  minCardValue: number;      // Default: 2
  maxCardValue: number;      // Default: 99
  handSize: number;          // Default: 7  (UI range 5–9)
  minPlayers: number;        // Default: 2  (multiplayer)
  maxPlayers: number;        // Default: 6  (multiplayer)
  minCardsPerTurn: number;   // Default: 2  (range 1–3)
  autoRefillHand: boolean;   // Default: false (multiplayer), true (solitaire)
  allowUndo: boolean;        // Default: false
  privateGame: boolean;      // Default: false
  allowCardLookup: boolean;  // Default: false (cheat feature)
}
```

### Move Validation

The `isValidPlay()` function (in `packages/engine/src/rules.ts`) validates all card plays:

```typescript
function isValidPlay(card: Card, pile: FoundationPile): boolean {
  const top = pile.topCard.value;
  if (pile.type === 'ascending') {
    return card.value > top || card.value === top - 10;
  }
  return card.value < top || card.value === top + 10;
}
```

### Communication Flow

```
Client  ──emit event──►  Server
                         │  validates move
                         │  updates in-memory state
                         ▼
                      ack callback ──► requesting client
                      game:updated  ──► all clients in room
```

**All clients**:
1. Receive updated `GameState`
2. React re-renders derive all UI from the new state

### Rate Limiting

All Socket.IO events are rate-limited per socket ID using a sliding-window counter:

| Event                | Limit | Window  |
|----------------------|-------|---------|
| `game:create`        | 5     | 60 s    |
| `game:join`          | 10    | 10 s    |
| `game:rejoin`        | 5     | 30 s    |
| `game:lookup`        | 20    | 10 s    |
| `game:listJoinable`  | 30    | 10 s    |
| `game:start`         | 10    | 30 s    |
| `game:playCard`      | 60    | 10 s    |
| `game:nasCheat`      | 30    | 10 s    |
| `game:endTurn`       | 30    | 10 s    |
| `game:undoPlay`      | 30    | 10 s    |
| `game:endGame`       | 10    | 30 s    |
| `game:updateSettings`| 20    | 10 s    |
| `game:leave`         | 10    | 30 s    |
| `game:kickPlayer`    | 10    | 10 s    |
| `game:setReaction`   | 20    | 10 s    |
| `game:cardLookup`    | 10    | 10 s    |

### Statistics Tracking

**Tracked per player**:
- **Cards Played**: Total count
- **Total Movement**: Sum of `|newPileValue − oldPileValue|` for each play
- **Special Plays**: Count of backward-10 moves
- **Nas Cheats Used**: Card-swap cheat uses

**Aggregate** (in `GameStatistics`):
- `turns`: Total turns completed
- `startedAtMs` / `endedAtMs`: Wall-clock timestamps

---

## Strategic Elements

### General Strategy
1. **Save middle values (40–60)**: Most flexible for either pile type
2. **Play extremes early**: Very high (90+) and low (10−) cards have fewer opportunities
3. **Avoid pile convergence**: Don't let ascending and descending piles meet in the middle
4. **Coordinate**: In multiplayer, consider what opportunities you leave for the next player

### Using Backward-10 Effectively
- Don't waste early — save for stuck situations
- Use to create gaps for other players' cards
- Essential when piles are close together (e.g., ascending at 55, descending at 56)

### Common Mistakes
- Playing all middle values too early
- Forgetting about backward-10 when stuck
- Not checking draw pile count (affects minimum requirement)
- Letting piles converge in the middle range

---

## User Interface

### Visual Design
**Color scheme** (dark theme):
- Background: `#1a1a2e` (dark blue-black)
- Accent: `#e94560` (coral red)
- Ascending piles: light green
- Descending piles: light red/pink
- Text: `#ffffff` (white), `#a8a8a8` (gray)

### Interactive Elements
- **Card selection**: Click to select; highlights valid piles in real time
- **Valid piles**: Highlighted when a card is selected and a legal play exists
- **Backward-10 flash**: Golden flash animation + floating "🔥 ±10! 🔥" label
- **Turn indicator**: Dot strip showing turn order and distance ("Your turn in 2")
- **Draw pile counter**: Live remaining-card count

### Game Screens
1. **Landing**: Mode selection (Solitaire / Multiplayer)
2. **Multiplayer lobby**: Player setup, settings, game creation/joining
3. **Game Board**: Foundation piles, player hands, turn controls
4. **Statistics Modal**: End-game stats with player breakdown
5. **How to Play**: `how-to-play.html` (static, served from `apps/client/public/`)

---

## Testing

### Unit / Integration Tests
- `packages/engine/test/` — pure game-logic tests (Vitest)
- `packages/shared-types/test/` — Zod schema tests (Vitest)
- `apps/server/test/` — GameManager unit + Socket.IO integration tests (Vitest)
- `apps/client/src/*.test.tsx` — React component tests (Vitest + jsdom + Testing Library)

### End-to-End Tests
- `tests/e2e/` — Playwright smoke tests

---

## Documentation

See also:
- [README.md](./README.md) — Project overview and setup
- [requirements.md](./requirements.md) — Detailed requirements and feature status
- [GETTING_STARTED.md](./GETTING_STARTED.md) — Local dev setup
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Production deployment guide
- [FUTURE_IMPROVEMENTS.md](./FUTURE_IMPROVEMENTS.md) — Planned enhancements
- [apps/client/public/how-to-play.html](./apps/client/public/how-to-play.html) — Player-facing guide

---

**Last Updated**: 2026-03-18
**Version**: Current implementation (post-v1 refactor)
**Status**: Accurate — update whenever interfaces or defaults change
