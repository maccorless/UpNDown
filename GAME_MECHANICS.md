# Up-N-Down - Game Mechanics and Implementation Guide

## Game Overview
Up-N-Down is a cooperative card game where players work together to play all cards from their hands onto four foundation piles. The game features unique ascending and descending rules with a special "backward-10" move that adds strategic depth.

**Game Modes:**
- **Multiplayer**: 2-8 players, turn-based cooperative play
- **Solitaire**: Single player, continuous play for practice and solo challenge

## Core Game Mechanics

### Foundation Piles

The game features **4 foundation piles** with distinct placement rules:

#### Ascending Piles (2 piles marked "1↑")
- **Starting value**: 1 (or minimum card value - 1)
- **Normal play**: Card must be higher than current top card
- **Special play**: Card exactly 10 less than current top card

**Example**: If pile shows 67
- ✅ Valid: Any card 68-99 (normal ascending)
- ✅ Valid: 57 (67 - 10, backward-10 rule)
- ❌ Invalid: Any card < 57 or 58-66

#### Descending Piles (2 piles marked "100↓")
- **Starting value**: 100 (or maximum card value + 1)
- **Normal play**: Card must be lower than current top card
- **Special play**: Card exactly 10 more than current top card

**Example**: If pile shows 34
- ✅ Valid: Any card 2-33 (normal descending)
- ✅ Valid: 44 (34 + 10, backward-10 rule)
- ❌ Invalid: Any card > 44 or 35-43

### The "Backward-10" Rule

This special move is crucial for strategic play and recovery from difficult situations:

**Purpose**: Allows playing in the opposite direction by exactly 10 points
**When to use**:
- When piles are "stuck" close together
- To create opportunities for other players
- As a last resort to avoid game loss

**Statistics tracking**: Backward-10 moves are counted as "special plays" in game statistics

### Card Distribution

**Configurable parameters** (set by host in game settings):
- Card range: Default 2-99 (configurable, range 2-79 to 22-99)
- Hand size: Default 7 cards (configurable, range 4-10)
- Min cards per turn: Default 2 (configurable, range 1-3)
- Draw pile: Contains all remaining cards after initial deal

**Default configurations**:
- Multiplayer (2-8 players): 7 cards per player
- Solitaire: 7 cards in hand

## Game Flow

### Multiplayer Mode

#### 1. Game Setup
1. Host creates game and receives unique 6-character game ID
2. Other players join using game ID
3. Host configures settings (optional)
4. Host starts game

#### 2. Turn Structure
**Each turn consists of**:
1. Player plays at least minimum required cards (default: 2)
2. For each card played:
   - Select card from hand
   - Click valid foundation pile
   - Card moves to pile
   - Hand refills (if auto-refill enabled and draw pile has cards)
   - **Undo option**: Click "Undo" button to undo the last played card
3. Player clicks "End Turn" button
4. Turn advances to next player

**Undo functionality**:
- Can undo only the last card played during your turn
- Cannot undo after clicking "End Turn"
- Works with auto-refill: drawn card stays in hand, undone card returns
- Statistics are automatically rolled back

**Minimum cards per turn**:
- **Normal stage** (draw pile has cards): 2 cards minimum
- **Final stage** (draw pile empty): 1 card minimum
- Players may always play more than the minimum

**Auto-refill behavior** (configurable):
- **Enabled** (default): Draw immediately after playing each card
- **Disabled**: Draw all replacement cards at end of turn

**Undo functionality** (configurable):
- **Enabled**: Players can undo the last card played during their turn
- **Disabled** (default): All plays are final, no undo button appears
- When enabled, "Undo" button appears after playing a card
- Cannot undo after ending turn
- Statistics automatically roll back when undoing

**Debug mode** (configurable):
- **Enabled**: Shows detailed console logging for troubleshooting
- **Disabled** (default): Hides console messages for cleaner experience
- Useful for developers or when reporting technical issues

#### 3. Player Order
- Turn-based, clockwise rotation
- Players without cards are automatically skipped
- Game continues until all players empty their hands or no valid moves exist

#### 4. Win/Loss Detection
**Win condition**: All players have empty hands
**Loss condition**: Current player cannot play minimum required cards

Game automatically checks for valid moves and declares win/loss

### Pile Preferences (Multiplayer Only)

During other players' turns, you can mark your preferences for each foundation pile to help coordinate team play:

**How it works**:
1. Click the heart icon on the right side of any pile (only visible when it's NOT your turn)
2. Cycle through preference levels:
   - **None** (empty heart outline) → **Like** (green checkmark) → **Really Like** (orange heart) → **Love** (red double hearts) → **None**
3. Your preferences clear automatically when YOUR turn starts
4. All players can see everyone's preferences displayed above/below each pile

**Visual indicators**:
- **Like**: Green checkmark ✓ (width: 18px)
- **Really Like**: Orange filled heart (width: 18px)
- **Love**: Large red double hearts (width: 24px)

**Strategy tips**:
- Mark piles where you have many playable cards
- Help other players know which piles you can handle
- Coordinate to avoid conflicts where multiple players need the same pile

**Player slot positions**:
- Top row: Players 1-4 (join order)
- Bottom row: Players 5-8 (join order)
- Turn order display shows: "Name (1) (You)"

### Solitaire Mode

**Differences from multiplayer**:
- No turns - continuous play
- No minimum card requirement
- Auto-refill always enabled
- Play as many cards as possible
- Perfect for learning game mechanics
- No pile preferences (not needed in solo play)

## Implementation Details

### Technology Stack
- **Frontend**: React with TypeScript, Vite
- **Backend**: Node.js with Express
- **Real-time**: Socket.IO for multiplayer synchronization
- **Database**: Firebase Realtime Database
- **Styling**: CSS with dark theme

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
  statistics: PlayerStatistics;
}
```

#### Foundation Pile State
```typescript
interface FoundationPile {
  id: number;
  type: 'ascending' | 'descending';
  cards: Card[];
}
```

#### Game Settings
```typescript
interface GameSettings {
  minCardValue: number;      // Range: 2-79
  maxCardValue: number;       // Range: 22-99 (must be minCardValue + 20)
  handSize: number;           // Range: 4-10
  minPlayers: number;         // Range: 1-8
  maxPlayers: number;         // Range: 1-8
  minCardsPerTurn: number;    // Range: 1-3
  allowUndo: boolean;         // Default: false - enables undo button
  autoRefillHand: boolean;    // Default: true - draw cards immediately
  debugMode: boolean;         // Default: false - show console logging
}
```

### Move Validation

The `isValidPlay()` function validates all card plays:

```typescript
function isValidPlay(card: Card, pile: FoundationPile): boolean {
  if (pile.cards.length === 0) {
    // First card rules
    if (pile.type === 'ascending') return card.value > 1;
    if (pile.type === 'descending') return card.value < 100;
  }

  const topCard = pile.cards[pile.cards.length - 1];

  if (pile.type === 'ascending') {
    // Normal: higher value OR Backward-10: exactly 10 lower
    return card.value > topCard.value || card.value === topCard.value - 10;
  } else {
    // Normal: lower value OR Backward-10: exactly 10 higher
    return card.value < topCard.value || card.value === topCard.value + 10;
  }
}
```

### Communication Flow

**Client → Server**:
1. Client emits Socket.IO event (e.g., `game:playCard`)
2. Event includes gameId, playerId, cardId, pileId

**Server processing**:
1. Validates player turn
2. Validates move legality
3. Updates game state in Firebase
4. Returns callback response to requesting client

**Server → Clients**:
1. Sends callback acknowledgment to requesting client (synchronous)
2. Broadcasts `game:updated` event to other players (asynchronous)

**All clients**:
1. Receive updated game state
2. Update local React context
3. Re-render UI components

### Statistics Tracking

**Tracked per player and in aggregate**:
- **Cards Played**: Total count
- **Total Movement**: Sum of `|newPileValue - oldPileValue|` for each card
- **Special Plays**: Count of backward-10 moves
- **Average Movement**: Total movement ÷ cards played

**Calculation example**:
- Pile shows 45, play 47: movement = |47 - 45| = 2
- Pile shows 67, play 57: movement = |57 - 67| = 10 (special play)

### Critical Implementation Details

#### Firebase Null-Safety
**Issue**: Firebase converts empty arrays to `null`
**Solution**: Defensive programming with `(array || [])`

```typescript
// Correct approach
const hand = currentPlayer.hand || [];
const handSize = (currentPlayer.hand || []).length;

// Prevents: TypeError: Cannot read properties of undefined (reading 'length')
```

Applied to all array access throughout codebase.

#### React Hooks Consistency
**Issue**: Early returns before hooks cause "Rendered fewer hooks than expected"
**Solution**: All hooks called before conditional logic

```typescript
// Correct
const players = gameState.players || [];
const currentPlayer = players[gameState.currentPlayerIndex];
const isMyTurn = currentPlayer ? currentPlayer.id === playerId : false;

if (!currentPlayer) {
  // Handle safely without early return
}
```

#### Type Safety
- Full TypeScript implementation
- Shared type definitions between client and server
- Compile-time validation prevents runtime errors
- Ambient type definitions for Vite environment

## Strategic Elements

### General Strategy
1. **Save middle values (40-60)**: Most flexible for either pile type
2. **Play extremes early**: Very high (90+) and low (10-) cards have fewer opportunities
3. **Avoid pile convergence**: Don't let ascending and descending piles meet in middle
4. **Coordinate**: In multiplayer, consider what opportunities you leave for next player

### Using Backward-10 Effectively
- Don't waste early - save for stuck situations
- Use to create gaps for other players' cards
- Essential when piles are close together (e.g., ascending at 55, descending at 56)

### Common Mistakes
- Playing all middle values too early
- Forgetting about backward-10 when stuck
- Not checking draw pile count (affects minimum requirement)
- Letting piles converge in middle range

## User Interface

### Visual Design
**Color scheme** (dark theme):
- Background: #1a1a2e (dark blue-black)
- Accent: #e94560 (coral red)
- Ascending piles: #90ee90 (light green)
- Descending piles: #ffb6b6 (light red/pink)
- Text: #ffffff (white), #a8a8a8 (gray)

### Interactive Elements
- **Card selection**: Click to select, highlights selected card
- **Valid piles**: Highlight when holding valid card
- **Hover effects**: Visual feedback on all interactive elements
- **Turn indicator**: Shows whose turn it is
- **Draw pile counter**: Displays remaining cards

### Game Screens
1. **Lobby**: Player setup, settings, game creation/joining
2. **Game Board**: Foundation piles, player hands, turn controls
3. **Statistics Modal**: End-game statistics with player breakdown
4. **User Guide**: Comprehensive rules and strategy (USER_GUIDE.html)

## Testing Scenarios

### Basic Functionality
- ✅ Game creation and joining via game ID
- ✅ Playing cards on valid piles (normal moves)
- ✅ Playing backward-10 special moves
- ✅ Turn progression and minimum card enforcement
- ✅ Draw pile exhaustion and final stage
- ✅ Win detection (all hands empty)
- ✅ Loss detection (no valid moves)

### Edge Cases
- ✅ Player runs out of cards mid-game (turn skip)
- ✅ Player disconnection/reconnection
- ✅ Empty array handling (Firebase null conversion)
- ✅ Statistics calculation and display
- ✅ Settings application from host
- ✅ Game ID collision detection

### Solitaire Mode
- ✅ Continuous play without turn restrictions
- ✅ Auto-refill always active
- ✅ Win/loss detection

## Known Issues and Solutions

### Resolved Issues
1. ✅ **Black screen on hand empty**: Fixed with defensive array handling
2. ✅ **React hooks violation**: Removed early returns before hooks
3. ✅ **Statistics not saving**: Added players array to Firebase updates
4. ✅ **TypeScript build errors**: Fixed all 15 production build errors
5. ✅ **Game ID collisions**: Added collision detection with retry mechanism

### Future Improvements
1. ✅ **Undo functionality**: Implemented - can undo last card played during turn (configurable)
2. ✅ **Debug mode**: Implemented - conditional console logging (configurable)
3. ✅ **Pile preferences**: Implemented - like/really like/love system with cycling icons
4. 🔄 **In-game chat**: Real-time communication
5. 🔄 **Special play animations**: Visual highlight for backward-10 moves
6. 🔄 **Mobile responsiveness**: Optimize for touch devices

## Performance Considerations

### Optimization Strategies
- Minimize Firebase read/write operations
- Use Socket.IO callbacks for synchronous responses
- Defensive coding prevents cascading errors
- Type safety prevents runtime type errors

### Scalability
- Game state cleanup for abandoned games (future)
- Separate Firebase instances for dev/prod (future)
- Rate limiting on Socket.IO events (future)

## Development Guidelines

### Code Organization
- **Client**: `/client/src/` - React components, contexts, services
- **Server**: `/server/src/` - Game logic, Socket.IO handlers, Firebase integration
- **Shared**: Type definitions must match between client and server

### Best Practices
1. Always use TypeScript strict mode
2. Apply defensive array handling `(array || [])`
3. Validate all moves server-side
4. Use callbacks for synchronous acknowledgments
5. Broadcast to other clients after validation
6. Test both solitaire and multiplayer modes
7. Test edge cases (disconnection, empty hands, draw pile exhaustion)

### Adding New Features
1. Define TypeScript interfaces
2. Implement server-side logic in `game.service.ts`
3. Add Socket.IO event handlers in `server/index.ts`
4. Update client context in `GameContext.tsx`
5. Create/update UI components
6. Test multiplayer synchronization
7. Update documentation

## Documentation

See also:
- [README.md](./README.md) - Project overview and setup
- [requirements.md](./requirements.md) - Detailed requirements and feature status
- [GameModuleView.md](./GameModuleView.md) - Architecture overview
- [USER_GUIDE.html](./client/public/USER_GUIDE.html) - Player-facing guide

---

**Last Updated**: 2025-11-12
**Version**: 1.0
**Status**: Current implementation, production-ready
