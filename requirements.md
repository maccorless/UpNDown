# Up-N-Down - Requirements Specification

## 1. Game Overview
A cooperative multiplayer card game where players work together to play all their cards on four different foundation piles. Players must communicate and strategize to succeed, as all players either win or lose together.

## 2. Game Rules

### 2.1 Basic Setup
- **Player Count**:
  - Multiplayer: 2-8 players
  - Solitaire: 1 player
- **Card Deck**: Numbered cards with configurable range (default: 2-99)
- **Four Foundation Piles**:
  - Two ascending piles (starting at 1, or one less than minimum card value)
  - Two descending piles (starting at 100, or one more than maximum card value)
- **Starting Hands**:
  - Default: 7 cards per player
  - Configurable via settings
- **Draw Pile**: Remaining cards after initial deal
- **Configurable Settings**: Card range, hand size, player limits, minimum cards per turn, auto-refill behavior

**Status**: ✅ **Implemented**

### 2.2 Gameplay Mechanics

#### Turn Structure (Multiplayer)
- Players must play minimum 2 cards per turn while draw pile has cards
- During final stage (draw pile empty), minimum reduces to 1 card per turn
- Players may play more than the minimum if they choose
- No time limit for turns
- When a player ends their turn, they draw replacement cards from draw pile (up to hand size)
- **Status**: ✅ **Implemented**

#### Solitaire Mode
- Continuous play with no turn restrictions
- Play as many cards as possible each round
- Auto-refill always enabled
- **Status**: ✅ **Implemented**

#### Card Placement Rules
- **Ascending piles**: Play cards with higher values than top card
- **Descending piles**: Play cards with lower values than top card
- **Special "Backward-10" Rule**:
  - Ascending piles: Can play a card exactly 10 lower than current top card
  - Descending piles: Can play a card exactly 10 higher than current top card
- **Status**: ✅ **Implemented**

#### Hand Management
- Auto-refill option (configurable):
  - **Enabled**: Draw immediately after playing each card
  - **Disabled**: Draw all replacement cards at turn end
- Solitaire mode always uses auto-refill
- **Status**: ✅ **Implemented**

#### Player Elimination Handling
- When a player runs out of cards in multiplayer, their turn is automatically skipped
- Game continues with remaining players who have cards
- **Status**: ✅ **Implemented**

#### Undo Functionality
- Players can undo card plays within their current turn (one at a time, back to start of turn)
- Once "End Turn" is clicked, undo history is cleared — no cross-turn undo
- Works in both multiplayer (server-side snapshot stack) and solitaire (client-side)
- **Status**: ✅ **Implemented**

### 2.3 Win/Loss Conditions

#### Win Condition
- All players successfully play all their cards from their hands
- Cooperative victory - all players win together
- **Status**: ✅ **Implemented**

#### Loss Condition
- The current player cannot make the required minimum plays on their turn
- Game automatically detects when no valid moves exist
- All players lose together
- **Status**: ✅ **Implemented**

### 2.4 Player Communication

#### Foundation Pile Preferences
- Players can mark individual piles as "like" (👍), "love" (❤️), or "really love" (🔥) when not their turn
- Purely communicative - no mechanical effect
- Signals to other players that they have beneficial cards for that pile
- Click your indicator to cycle: off → like → love → really love → off
- Each player has a fixed indicator slot per pile (players 1-3 left, 4-6 right)
- Preferences reset when player's turn starts
- Cannot set reactions during your own turn
- **Status**: ✅ **Implemented**

#### In-Game Chat (Future)
- Real-time chat system for player coordination
- Chat history preserved during disconnections
- Players see missed messages upon reconnection
- **Status**: 🔄 **Planned**

## 3. Technical Requirements

### 3.1 Platform & Architecture
- **Platform**: Web-based application
- **Frontend**: React with TypeScript, Vite build system
- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.IO for instant multiplayer updates
- **Database**: Firebase Realtime Database
- **Styling**: CSS with CSS variables for theming
- **Status**: ✅ **Implemented**

### 3.2 User Management
- **No Formal Registration**: Quick play without accounts
- **Persistent User ID**: UUID stored in browser localStorage
- **Player Names**: User-provided display names
- **No Authentication**: Suitable for private deployment
- **Status**: ✅ **Implemented**

### 3.3 Game Session Management

#### Game Creation & Joining
- **6-character unique game ID** for each game
- Game ID collision detection with retry mechanism
- Host creates game and controls when to start
- Other players join using game ID
- **Status**: ✅ **Implemented**

#### Game Settings
- Only host's settings apply to the game
- Configurable parameters:
  - Card range (min/max values)
  - Hand size
  - Player limits (min/max)
  - Minimum cards per turn
  - Auto-refill hand behavior
  - Allow undo (future)
- **Status**: ✅ **Implemented**

### 3.4 Disconnection Handling
- **Game State Persistence**: Automatic saves to Firebase
- **Reconnection Support**: Game state persists until explicitly abandoned
- **Graceful Degradation**: Empty array protection against Firebase null conversion
- **Chat History**: Preserved during disconnections (future feature)
- **Status**: ✅ **Implemented** (core functionality), 🔄 **Planned** (chat)

### 3.5 User Interface Requirements

#### Display Requirements
- **Desktop-focused design** (mobile planned for future)
- **Visual Pile Differentiation**:
  - Ascending piles: Light green background (#90ee90)
  - Descending piles: Light red/pink background (#ffb6b6)
- **Game State Displays**:
  - ✅ Player's own cards (visible)
  - ✅ Number of cards in other players' hands (count only)
  - ✅ Current game state and phase
  - ✅ Turn indicator showing active player
  - ✅ Draw pile count
  - ✅ Game status (playing/won/lost)
  - ✅ Game ID during gameplay (copyable invite link)
  - ✅ Turn sequence display (dot strip showing turn order and "Your turn in X")
  - ✅ Pile preference indicators (like/love/really love per pile)
  - ✅ Backward-10 special play animation (golden flash + floating label)
  - ✅ End game confirmation modal (prevents accidental game termination)
  - 🔄 Chat interface (planned)

#### Color Scheme
- **Dark Theme**:
  - Primary background: #1a1a2e
  - Secondary background: #16213e
  - Tertiary background: #0f3460
  - Accent color: #e94560 (coral red)
  - Text: #ffffff (primary), #a8a8a8 (secondary)
- **Status**: ✅ **Implemented**

#### Interactive Elements
- Card selection highlighting
- Valid pile highlighting when card selected
- Hover effects on interactive elements
- Auto-focus on game ID input when joining
- **Status**: ✅ **Implemented**

### 3.6 Data Persistence Requirements
- Game state saved automatically to Firebase
- Game states maintained until explicitly abandoned by host
- Statistics tracked and persisted at game end
- Chat history preservation (future)
- **Status**: ✅ **Implemented** (core), 🔄 **Planned** (chat)

### 3.7 Real-time Features
Immediate updates via Socket.IO for:
- ✅ Card plays
- ✅ Turn changes
- ✅ Game state changes (win/loss)
- ✅ Player joining/leaving
- ✅ Game start
- ✅ Foundation pile preferences (real-time broadcast)
- ✅ Backward-10 special play notifications
- ✅ Undo play synchronization
- 🔄 Chat messages (future)

**Status**: ✅ **Core real-time features implemented**

### 3.8 Game Statistics

#### Tracked Statistics (Per Player and Aggregate)
- ✅ **Cards Played**: Total count of cards played
- ✅ **Total Movement**: Sum of absolute value changes in foundation pile values
- ✅ **Special Plays**: Count of backward-10 moves used
- ✅ **Average Movement**: Total movement divided by cards played

#### Statistics Display
- End-game statistics modal showing:
  - Overall game statistics (total across all players)
  - Individual player statistics
  - Average movement per card (efficiency metric)
- **Status**: ✅ **Implemented**

## 4. Implementation Status Summary

### Fully Implemented Features ✅
1. Multiplayer mode (2-8 players) with Socket.IO real-time sync
2. Solitaire mode for single-player
3. Game creation with 6-character unique IDs and collision detection
4. Join game via game ID
5. Customizable game settings
6. Turn-based gameplay with minimum card requirements
7. Backward-10 special move rule
8. Auto-refill hand option (immediate or end-of-turn)
9. Win/loss detection and game end handling
10. Player elimination handling (skip players without cards)
11. Comprehensive statistics tracking and display
12. Dark theme UI with visual feedback
13. User guide (how-to-play.html)
14. Firebase null-safety with defensive array handling
15. Player hand visibility (own cards only, card counts for others)
16. Undo within turn (server-side snapshot stack, clears on end turn)
17. Foundation pile preferences (like/love/really love per pile, real-time sync)
18. Turn sequence display (dot strip with turn distance indicator)
19. Backward-10 special play animation (golden flash + floating "🔥 -10! 🔥" label)
20. End game confirmation modal (prevents accidental termination of active games)
21. Game ID displayed during gameplay with one-click invite link copy
22. Player kick (lobby): Host can remove players via ✕ button; kicked player is notified and returned to home

### Planned Features 🔄

#### Medium Priority
2. **Separate Firebase Instances**: Dev and prod database separation
3. **Peek at Hands**: Allow players to view others' hands (with permission)
4. **Drag-and-Drop Cards**: Enhanced card movement interaction
5. **Mobile Responsive Design**: Optimize for tablets and phones

#### Lower Priority
6. **In-game Chat System**: Real-time text communication
7. **Patterned Cards**: Visual card designs beyond numbered cards
8. **Achievement System**: Track and reward player accomplishments
9. **Game History & Replay**: Review past games

### Explicitly Not Planned ❌
- Mid-game joining (disrupts cooperative balance)
- Player authentication system (private deployment)
- Individual win conditions (cooperative game only)

## 5. Architecture Details

### Client-Server Communication
```
Client → Socket.IO Event → Server
Server → Validates & Updates Firebase
Server → Callback Response → Requesting Client
Server → Broadcast Event → Other Clients
All Clients → Update Local State
```

### Socket.IO Events (Implemented)
- `game:create` - Create new game
- `game:join` - Join existing game
- `game:leave` - Leave game
- `game:start` - Start game
- `game:playCard` - Play a card
- `game:endTurn` - End current turn
- `game:endGame` - Host ends active game
- `game:undoPlay` - Undo last card play within current turn
- `game:setReaction` - Set pile preference (like/love/really love)
- `game:nasCheat` - Use Nas Cheat ability
- `game:reactionsUpdated` - Broadcast reaction state changes (server → clients)
- `game:specialPlay` - Broadcast backward-10 move notification (server → clients)
- `game:kickPlayer` - Host kicks a player from the lobby
- `game:kicked` - Notify kicked player (server → kicked client)

### Game State Management
- **Server**: Single source of truth in Firebase
- **Client**: React Context for local state management
- **Synchronization**: Real-time via Socket.IO with callback acknowledgments

### Type Safety
- Shared TypeScript interfaces between client and server
- Full type definitions for game state, players, cards, settings
- Compile-time type checking prevents runtime errors

## 6. Quality Assurance

### Testing Approach
- Manual testing for all game scenarios
- Test cases:
  - Game creation and joining
  - Card playing and turn progression
  - Win/loss detection
  - Player disconnection/reconnection
  - Statistics calculation
  - Settings application
  - Solitaire mode
  - Edge cases (empty hands, draw pile exhaustion)

### Known Issues & Solutions
1. **Firebase Empty Array Conversion**: Solved with defensive `(array || [])` pattern
2. **React Hooks Violations**: Solved by removing early returns before hooks
3. **TypeScript Build Errors**: All 15 errors resolved for production builds
4. **Statistics Not Persisting**: Fixed by including players array in Firebase updates

## 7. Deployment Considerations

### Development Environment
- Client dev server: http://localhost:5173 (Vite)
- Server dev server: http://localhost:3001 (ts-node-dev)
- Firebase Realtime Database with open rules (dev only)

### Production Requirements
- Build both client and server TypeScript
- Configure production Firebase rules with authentication
- Set production environment variables
- Configure CORS for production domain
- Consider CDN for client static assets

## 8. Future Technical Enhancements

### Performance
- Optimize Firebase read/write operations
- Implement client-side caching
- Lazy load components
- Code splitting for faster initial load

### Scalability
- Separate Firebase instances for dev/staging/prod
- Rate limiting on Socket.IO events
- Game state cleanup for abandoned games
- Database indexing for quick game lookups

### User Experience
- Progressive Web App (PWA) capabilities
- Offline game mode (solitaire only)
- Sound effects and music
- Accessibility improvements (ARIA labels, keyboard navigation)
- Internationalization (i18n) support

## 9. Success Metrics

### Technical Metrics
- Zero runtime type errors
- Sub-100ms Socket.IO round-trip time
- 100% game state consistency across clients
- Successful builds for both client and server

### User Experience Metrics
- Game creation success rate
- Average game completion time
- Player retention (return players)
- Win rate by game settings configuration

## 10. Version History

### Current Version (v1.0)
- Full multiplayer and solitaire gameplay
- Comprehensive statistics tracking
- User guide and documentation
- Production-ready TypeScript builds
- Firebase integration with null-safety
- Socket.IO real-time synchronization

### Planned Version (v2.0)
- Undo functionality
- Pile preference system
- In-game chat
- Enhanced UI features
- Mobile responsive design

---

**Document Status**: Updated to reflect current implementation as of 2025-11-12

**Maintenance**: Update this document when new features are implemented or requirements change
