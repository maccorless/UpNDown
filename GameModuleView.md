# Up-N-Down Card Game - Architecture Overview

## Project Structure

```
UpNDown/
├── client/                      # Frontend React application
│   ├── public/
│   │   └── USER_GUIDE.html     # Player-facing game guide
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── card/
│   │   │   │   ├── Card.tsx    # Individual card display
│   │   │   │   └── Card.css
│   │   │   ├── game/
│   │   │   │   ├── GameBoard.tsx      # Main game interface
│   │   │   │   ├── GameBoard.css
│   │   │   │   ├── GameOverStats.tsx  # End-game statistics
│   │   │   │   └── GameOverStats.css
│   │   │   ├── lobby/
│   │   │   │   ├── Lobby.tsx          # Game creation/joining
│   │   │   │   └── Lobby.css
│   │   │   ├── pile/
│   │   │   │   ├── Pile.tsx           # Foundation pile display
│   │   │   │   └── Pile.css
│   │   │   └── settings/
│   │   │       ├── SettingsEditor.tsx # Game settings configuration
│   │   │       └── SettingsEditor.css
│   │   ├── contexts/
│   │   │   └── GameContext.tsx        # Global game state management
│   │   ├── services/
│   │   │   └── socket.service.ts      # Socket.IO client wrapper
│   │   ├── styles/
│   │   │   ├── index.css              # Global styles and CSS variables
│   │   │   └── App.css                # App-level styles
│   │   ├── types/
│   │   │   └── game.types.ts          # TypeScript type definitions
│   │   ├── App.tsx                    # Root component
│   │   ├── main.tsx                   # Application entry point
│   │   └── vite-env.d.ts             # Vite ambient types
│   ├── .env.example                   # Environment variables template
│   ├── index.html                     # HTML entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── server/                      # Backend Node.js application
│   ├── src/
│   │   ├── services/
│   │   │   └── game.service.ts        # Core game logic and Firebase ops
│   │   ├── types/
│   │   │   └── game.types.ts          # TypeScript type definitions
│   │   └── index.ts                   # Server entry point with Socket.IO
│   ├── .env.example                   # Environment variables template
│   ├── package.json
│   └── tsconfig.json
│
├── GAME_MECHANICS.md            # Game rules and implementation guide
├── requirements.md              # Feature specifications
├── GameModuleView.md           # This file - architecture overview
└── README.md                    # Project overview and setup
```

## Architecture Layers

### Client Architecture

#### 1. Presentation Layer (Components)
**Purpose**: Render UI and handle user interactions

##### Card Component (`client/src/components/card/Card.tsx`)
- Displays individual numbered cards
- Handles click selection
- Shows selection highlighting
- Props: `card`, `onClick`, `isSelected`

##### Pile Component (`client/src/components/pile/Pile.tsx`)
- Displays foundation piles with stacked cards
- Shows pile type (ascending/descending) with visual differentiation
- Highlights when valid for selected card
- Shows top card value prominently
- Props: `pile`, `onCardPlay`, `isHighlighted`

##### GameBoard Component (`client/src/components/game/GameBoard.tsx`)
- Main gameplay interface
- Manages card selection state
- Handles card play actions
- Displays player hands and turn information
- Shows draw pile count
- Manages end turn functionality
- Checks for game over conditions

##### GameOverStats Component (`client/src/components/game/GameOverStats.tsx`)
- Modal display for end-game statistics
- Shows aggregate statistics (all players)
- Shows individual player statistics
- Calculates and displays average movement per card
- "Return to Lobby" functionality

##### Lobby Component (`client/src/components/lobby/Lobby.tsx`)
- Game creation interface
- Game joining interface
- Player name input
- Game ID input with auto-focus
- Settings editor integration
- Solitaire mode checkbox
- Player list display

##### SettingsEditor Component (`client/src/components/settings/SettingsEditor.tsx`)
- Configurable game parameters
- Card range (min/max values)
- Hand size
- Player limits (min/max)
- Minimum cards per turn
- Auto-refill hand toggle
- Allow undo toggle (future)

#### 2. State Management Layer (Context)

##### GameContext (`client/src/contexts/GameContext.tsx`)
**Purpose**: Centralized game state management with React Context

**State**:
```typescript
{
  playerId: string | null;
  playerName: string;
  gameState: GameState | null;
  error: string | null;
  isConnected: boolean;
}
```

**Actions**:
- `setPlayerName(name: string)`: Set player display name
- `createGame(settings: GameSettings)`: Create new game
- `joinGame(gameId: string)`: Join existing game
- `leaveGame()`: Leave current game
- `startGame()`: Start game (host only)
- `playCard(cardId: string, pileId: number)`: Play card to pile
- `endTurn()`: End current player's turn
- `checkGameStatus()`: Check for win/loss conditions
- `clearError()`: Clear error messages

**Hooks**:
- `useGame()`: Access game context in components

#### 3. Service Layer

##### Socket Service (`client/src/services/socket.service.ts`)
**Purpose**: Wrapper around Socket.IO client for type-safe communication

**Methods**:
- `connect()`: Establish Socket.IO connection
- `disconnect()`: Close connection
- `emit(event, data, callback)`: Send event to server
- `on(event, handler)`: Listen for server events
- `off(event, handler)`: Remove event listener

**Events Emitted**:
- `game:create`
- `game:join`
- `game:leave`
- `game:start`
- `game:playCard`
- `game:endTurn`
- `game:checkStatus`

**Events Listened**:
- `connect` / `disconnect`
- `game:updated` (broadcast from server)
- `game:error`

#### 4. Type Definitions (`client/src/types/game.types.ts`)

**Key Interfaces**:
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

interface Player {
  id: string;
  name: string;
  hand: Card[];
  isHost: boolean;
  statistics: PlayerStatistics;
}

interface Card {
  id: string;
  value: number;
}

interface FoundationPile {
  id: number;
  type: 'ascending' | 'descending';
  cards: Card[];
}

interface GameSettings {
  minCardValue: number;
  maxCardValue: number;
  handSize: number;
  minPlayers: number;
  maxPlayers: number;
  minCardsPerTurn: number;
  allowUndo: boolean;
  autoRefillHand: boolean;
}

interface PlayerStatistics {
  cardsPlayed: number;
  totalMovement: number;
  specialPlays: number;
}
```

### Server Architecture

#### 1. Application Layer (`server/src/index.ts`)
**Purpose**: Express server setup and Socket.IO event handling

**Components**:
- Express HTTP server
- Socket.IO WebSocket server
- CORS configuration
- Health check endpoint
- Socket.IO event handlers

**Socket.IO Events Handled**:
- `connection`: Client connects
- `game:create`: Create new game
- `game:join`: Join existing game
- `game:leave`: Leave game
- `game:start`: Start game
- `game:playCard`: Play card to pile
- `game:endTurn`: End player turn
- `game:checkStatus`: Check win/loss
- `game:setPilePreference`: Set pile preference (future)
- `disconnect`: Client disconnects

**Communication Pattern**:
1. Receive event from client
2. Call GameService method
3. Send callback response to requesting client (synchronous)
4. Broadcast `game:updated` to other clients (asynchronous)

#### 2. Business Logic Layer (`server/src/services/game.service.ts`)
**Purpose**: Core game logic and Firebase operations

**Key Methods**:

##### Game Management
- `createGame(hostId, hostName, settings)`: Create new game with unique ID
- `addPlayer(gameId, playerId, playerName)`: Add player to game
- `removePlayer(gameId, playerId)`: Remove player from game
- `startGame(gameId)`: Initialize game from lobby
- `checkGameStatus(gameId)`: Check and update win/loss status

##### Gameplay
- `playCard(gameId, playerId, cardId, pileId)`: Execute card play
  - Validates player turn
  - Validates move legality
  - Updates pile and hand
  - Refills hand (if auto-refill enabled)
  - Tracks statistics
  - Returns updated game state

- `endTurn(gameId, playerId)`: End current player's turn
  - Validates minimum cards played
  - Refills hand (if auto-refill disabled)
  - Advances to next player
  - Checks for game over

##### Helper Methods
- `generateUniqueGameId()`: Generate 6-char ID with collision detection
- `generateGameId()`: Generate random 6-char uppercase alphanumeric
- `initializeGame(settings)`: Create initial game state
- `shuffleArray(array)`: Randomize array order
- `isValidPlay(card, pile)`: Validate card placement
- `canPlayerMakeAnyMove(player, piles)`: Check if player has valid moves
- `trackStatistics(player, card, pile)`: Update player statistics

**Firebase Operations**:
- Create game: `gamesRef.child(gameId).set(gameState)`
- Read game: `gamesRef.child(gameId).once('value')`
- Update game: `gameRef.update(updates)`
- All operations use defensive array handling for null safety

#### 3. Type Definitions (`server/src/types/game.types.ts`)
**Note**: Must match client type definitions exactly for consistency

## Data Flow

### Game Creation Flow
```
Client (Lobby)
  ↓ emit 'game:create'
Server (index.ts)
  ↓ call gameService.createGame()
GameService
  ↓ generate unique ID
  ↓ initialize game state
  ↓ save to Firebase
  ↓ return game state
Server
  ↓ callback response
Client (GameContext)
  ↓ update local state
  ↓ navigate to game board
```

### Game Join Flow
```
Client (Lobby)
  ↓ emit 'game:join'
Server (index.ts)
  ↓ call gameService.addPlayer()
GameService
  ↓ read game from Firebase
  ↓ validate game exists
  ↓ add player to players array
  ↓ save to Firebase
  ↓ return game state
Server
  ↓ callback to requesting client
  ↓ broadcast to other clients
All Clients (GameContext)
  ↓ update local state
  ↓ render updated player list
```

### Card Play Flow
```
Client (GameBoard)
  ↓ user selects card, clicks pile
  ↓ emit 'game:playCard'
Server (index.ts)
  ↓ call gameService.playCard()
GameService
  ↓ read game from Firebase
  ↓ validate player turn
  ↓ validate move with isValidPlay()
  ↓ remove card from hand
  ↓ add card to pile
  ↓ track statistics (movement, special plays)
  ↓ refill hand (if auto-refill)
  ↓ check game over conditions
  ↓ save to Firebase
  ↓ return game state
Server
  ↓ callback to requesting client
  ↓ broadcast to other clients
All Clients (GameContext)
  ↓ update local state
  ↓ re-render game board
  ↓ show updated piles and hands
  ↓ display statistics if game over
```

### Turn End Flow
```
Client (GameBoard)
  ↓ user clicks "End Turn"
  ↓ emit 'game:endTurn'
Server (index.ts)
  ↓ call gameService.endTurn()
GameService
  ↓ read game from Firebase
  ↓ validate minimum cards played
  ↓ refill hand (if auto-refill disabled)
  ↓ advance currentPlayerIndex
  ↓ skip players with empty hands
  ↓ reset cardsPlayedThisTurn
  ↓ check game over conditions
  ↓ save to Firebase
  ↓ return game state
Server
  ↓ callback to requesting client
  ↓ broadcast to other clients
All Clients (GameContext)
  ↓ update local state
  ↓ render turn indicator
  ↓ enable/disable controls based on turn
```

## Key Design Patterns

### 1. Single Source of Truth
- **Firebase Realtime Database** is authoritative
- Server validates and writes to Firebase
- Clients read and display from Firebase
- No client-side game logic execution (only validation for UX)

### 2. Optimistic UI with Callback Confirmation
- Client emits action
- Server validates and responds via callback
- Client updates only after server confirmation
- Prevents desyncs and invalid states

### 3. Broadcast Pattern
- Requesting client gets callback response (synchronous)
- Other clients get broadcast event (asynchronous)
- All clients end up with same state
- Reduces perceived latency for actor

### 4. Defensive Programming
- All array access uses `(array || [])` pattern
- Protects against Firebase null conversion
- Prevents cascading errors
- Graceful degradation

### 5. Type Safety
- TypeScript throughout stack
- Shared type definitions
- Compile-time validation
- Runtime type consistency

### 6. Component Composition
- Small, focused components
- Clear prop interfaces
- Separation of concerns
- Reusable UI elements

## Critical Implementation Details

### Firebase Null Conversion
**Problem**: Firebase converts empty arrays `[]` to `null` when syncing
**Solution**: Defensive access pattern applied everywhere:
```typescript
const hand = player.hand || [];
const handSize = (player.hand || []).length;
const cards = pile.cards || [];
```

**Locations**: All array access in both client and server code

### React Hooks Rules
**Problem**: Early returns before hooks violate React rules
**Solution**: All hooks called before any conditional logic:
```typescript
// Correct
const players = gameState.players || [];
const currentPlayer = players[index];
const isMyTurn = currentPlayer ? currentPlayer.id === playerId : false;

// Incorrect (don't do this)
if (!currentPlayer) return null; // ❌ Before hooks
```

### Game ID Collision
**Problem**: Random 6-char IDs could theoretically collide
**Solution**: Check Firebase for existing ID before creating:
```typescript
async generateUniqueGameId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = this.generateGameId();
    const exists = await this.gamesRef.child(id).once('value');
    if (!exists.exists()) return id;
  }
  // Fallback to UUID prefix
  return uuidv4().substring(0, 6).toUpperCase();
}
```

### Statistics Persistence
**Problem**: Statistics calculated but not saved to Firebase
**Solution**: Include players array in all game state updates:
```typescript
await gameRef.update({
  gamePhase: 'won',
  players: gameState.players, // Include updated statistics
  // ... other fields
});
```

## Security Considerations

### Current State (Development)
- Open Firebase rules (read/write: true)
- No authentication required
- Suitable for private deployment only

### Production Recommendations
1. **Firebase Rules**: Implement proper authentication
2. **Server Validation**: All moves validated server-side ✅
3. **Rate Limiting**: Prevent Socket.IO event spam (future)
4. **CORS**: Configure allowed origins ✅
5. **Environment Variables**: Secure credential management ✅

## Performance Characteristics

### Latency
- Socket.IO round-trip: ~10-50ms on local network
- Firebase write: ~50-100ms
- Total action latency: ~60-150ms
- Acceptable for turn-based gameplay

### Scalability
- Current: Single Firebase Realtime Database instance
- Limitation: ~100,000 concurrent connections per database
- Sufficient for private deployment
- For public: Consider sharding by game ID

### Optimization Opportunities
1. Client-side caching (future)
2. Batch Firebase writes (future)
3. Lazy load components (future)
4. Code splitting (future)

## Testing Strategy

### Current Approach
- Manual testing of all scenarios
- Test both solitaire and multiplayer
- Verify statistics accuracy
- Test edge cases (disconnection, empty hands)

### Test Scenarios
1. **Game Creation**: Unique IDs, settings application
2. **Game Joining**: Multiple players, player limits
3. **Card Playing**: Valid/invalid moves, special plays
4. **Turn Management**: Minimum cards, turn advancement
5. **Game End**: Win/loss detection, statistics display
6. **Disconnection**: Reconnection, state persistence
7. **Solitaire**: Continuous play, auto-refill

## Future Architecture Enhancements

### Planned Improvements
1. **Undo System**: Move history stack, rollback capability
2. **Chat System**: Real-time messaging layer
3. **Pile Preferences**: Additional player state for communication
4. **Authentication**: User accounts, game history
5. **Mobile Support**: Responsive design, touch optimization

### Scalability Improvements
1. **Multiple Firebase Instances**: Separate dev/staging/prod
2. **Game Cleanup**: Automated removal of abandoned games
3. **Rate Limiting**: Socket.IO event throttling
4. **Caching Layer**: Redis for frequently accessed game states

### Developer Experience
1. **Unit Tests**: Jest for game logic
2. **Integration Tests**: Socket.IO event testing
3. **E2E Tests**: Playwright for full game flows
4. **CI/CD**: Automated builds and deployments

## Documentation

### For Players
- [USER_GUIDE.html](./client/public/USER_GUIDE.html) - Complete game guide

### For Developers
- [README.md](./README.md) - Setup and getting started
- [GAME_MECHANICS.md](./GAME_MECHANICS.md) - Game rules and implementation
- [requirements.md](./requirements.md) - Feature specifications
- This file (GameModuleView.md) - Architecture overview

---

**Last Updated**: 2025-11-12
**Architecture Version**: 1.0
**Status**: Production-ready, actively maintained
