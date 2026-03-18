# Up-N-Down — Requirements Specification

## 1. Game Overview
A cooperative multiplayer card game where players work together to play all their cards onto four foundation piles. Players must communicate and strategise to succeed — all players win or lose together.

---

## 2. Game Rules

### 2.1 Basic Setup
- **Player Count**:
  - Multiplayer: 2–6 players
  - Solitaire: 1 player
- **Card Deck**: Numbered cards with configurable range (default: 2–99)
- **Four Foundation Piles**:
  - Two ascending piles (starting at 1, or `minCardValue − 1`)
  - Two descending piles (starting at 100, or `maxCardValue + 1`)
- **Starting Hands**: Default 7 cards per player (configurable)
- **Draw Pile**: Remaining cards after initial deal
- **Configurable Settings**: Card range, hand size, player limits, min cards per turn, auto-refill, undo, privacy, card-lookup cheat

**Status**: ✅ **Implemented**

---

### 2.2 Gameplay Mechanics

#### Turn Structure (Multiplayer)
- Players must play at least `minCardsPerTurn` cards while the draw pile has cards (default: 2)
- During the final stage (draw pile empty), minimum reduces to 1 card per turn
- Players may play more than the minimum
- No time limit for turns
- When `autoRefillHand` is disabled: player draws replacement cards at end of turn (up to hand size)
- When `autoRefillHand` is enabled: player draws one card after each play
- **Status**: ✅ **Implemented**

#### Solitaire Mode
- Continuous play — no turn structure
- `autoRefillHand` always `true`
- No minimum card requirement
- **Status**: ✅ **Implemented**

#### Card Placement Rules
- **Ascending piles**: Play cards with higher values than top card
- **Descending piles**: Play cards with lower values than top card
- **Special "Backward-10" Rule**:
  - Ascending piles: Can play a card exactly 10 lower than current top card
  - Descending piles: Can play a card exactly 10 higher than current top card
- **Status**: ✅ **Implemented**

#### Hand Management
- Auto-refill option (configurable via `autoRefillHand`):
  - **Enabled**: Draw immediately after playing each card
  - **Disabled** (default multiplayer): Draw all replacement cards at turn end
- Solitaire always uses auto-refill
- **Status**: ✅ **Implemented**

#### Player Elimination Handling
- When a player runs out of cards in multiplayer, their turn is automatically skipped
- Game continues with remaining players who have cards
- **Status**: ✅ **Implemented**

#### Undo Functionality
- Players can undo card plays within their current turn, one at a time, back to the start of turn
- "End Turn" clears the undo stack — no cross-turn undo
- Multiplayer undo is server-authoritative (snapshot stack in `GameRoom`)
- Solitaire undo is client-side
- Requires `allowUndo: true` in settings (disabled by default)
- **Status**: ✅ **Implemented**

#### Player Kick (Lobby & Active Game)
- Host can remove any other player at any time (lobby or active game)
- Kicked player's cards are returned to the draw pile (shuffled in)
- Kicked player receives a `game:kicked` notification and is returned to the home screen
- **Status**: ✅ **Implemented**

---

### 2.3 Win/Loss Conditions

#### Win Condition
- All players successfully play all cards from their hands
- Cooperative victory — all players win together
- **Status**: ✅ **Implemented**

#### Loss Condition
- The current player cannot make any legal card play AND has not yet met the minimum-plays requirement
- Game automatically detects no-legal-move situations after every play and turn transition
- All players lose together
- **Status**: ✅ **Implemented**

---

### 2.4 Player Communication

#### Foundation Pile Reactions
- Players can mark individual piles as **Like** (👍), **Love** (❤️), or **Really Love** (🔥) when it is not their turn
- Purely communicative — no mechanical effect
- Click your indicator slot to cycle: off → like → love → really love → off
- Each player has a fixed slot per pile (players 1–3 on the left, 4–6 on the right)
- Reactions reset when the player's turn starts
- Cannot set reactions during your own turn
- **Status**: ✅ **Implemented**

#### In-Game Chat
- Real-time chat system for player coordination
- **Status**: 🔄 **Planned**

---

## 3. Technical Requirements

### 3.1 Platform & Architecture
- **Platform**: Web-based application
- **Frontend**: React with TypeScript, Vite build system
- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.IO for instant multiplayer updates
- **State Storage**: In-memory `Map` with TTL-based orphan reaping (no external database)
- **Styling**: CSS with CSS variables for theming
- **Status**: ✅ **Implemented**

### 3.2 Monorepo Structure
```
packages/shared-types   TypeScript interfaces + Zod validation schemas
packages/engine         Pure game-logic functions (no I/O)
apps/client             React + Vite frontend
apps/server             Express + Socket.IO backend
tests/e2e               Playwright smoke tests
```

### 3.3 User Management
- **No Formal Registration**: Quick play without accounts
- **Session Identity**: Socket ID is the player ID; reconnection swaps old → new ID
- **Player Names**: User-provided display names (persisted in `localStorage`)
- **No Authentication**: Suitable for private/trusted deployment
- **Status**: ✅ **Implemented**

---

### 3.4 Game Session Management

#### Game Creation & Joining
- **6-character unique game ID** (A–Z, 0–9) for each game
- Collision detection with up to 20 retry attempts
- Host creates game and controls when to start
- Other players join via game ID or shareable invite link (`?game=XXXXXX`)
- Deep-link auto-join: if player name is already stored, join proceeds immediately
- **Status**: ✅ **Implemented**

#### Game Settings (Configurable by Host)
| Setting          | Default | Multiplayer Range | Notes                           |
|------------------|---------|------------------|---------------------------------|
| minCardValue     | 2       | 2–99             | Must leave ≥18 card deck size   |
| maxCardValue     | 99      | 2–99             |                                 |
| handSize         | 7       | 5–9              |                                 |
| minPlayers       | 2       | 2–6              |                                 |
| maxPlayers       | 6       | 2–6              |                                 |
| minCardsPerTurn  | 2       | 1–3              | Final stage always 1            |
| autoRefillHand   | false   | on/off           | Always on in solitaire          |
| allowUndo        | false   | on/off           |                                 |
| privateGame      | false   | on/off           | Hides from public join list     |
| allowCardLookup  | false   | on/off           | Cheat: Ctrl+Shift+C lookup      |

- **Status**: ✅ **Implemented**

---

### 3.5 Disconnection Handling
- **Lobby**: Disconnected player is auto-removed from the game; host transfers if needed
- **Active Game**: Player remains in the game state; reconnection restores them via `game:rejoin`
- Orphaned rooms (no connected players) are reaped after 5 min (lobby) / 30 min (active)
- **Status**: ✅ **Implemented**

---

### 3.6 User Interface Requirements

#### Display Requirements
- **Desktop-focused design** (mobile planned for future)
- **Visual Pile Differentiation**: Ascending = green tones, Descending = red/pink tones
- **Game State Displays**:
  - ✅ Player's own cards (full visibility)
  - ✅ Number of cards in other players' hands (count only)
  - ✅ Current game phase and turn indicator
  - ✅ Draw pile count
  - ✅ Game ID with one-click invite link copy
  - ✅ Turn sequence display (dot strip + "Your turn in X" label)
  - ✅ Pile reaction indicators (👍 ❤️ 🔥 per player per pile)
  - ✅ Backward-10 special play animation (golden flash + floating label)
  - ✅ End-game confirmation modal (prevents accidental game termination)
  - ✅ End-game statistics modal (per-player and aggregate)
  - ✅ Nas Cheat intro modal (for players named "nas")
  - 🔄 Chat interface (planned)

#### Interactive Elements
- Card selection highlighting
- Valid pile highlighting when a card is selected
- Hover effects on all interactive elements
- Auto-focus on game ID input when joining
- **Status**: ✅ **Implemented**

---

### 3.7 Real-time Features
Immediate updates via Socket.IO for:
- ✅ Card plays
- ✅ Turn changes
- ✅ Game state changes (win/loss)
- ✅ Player joining/leaving/kick
- ✅ Game start / end-game
- ✅ Foundation pile reactions (real-time broadcast)
- ✅ Backward-10 special play notifications
- ✅ Undo play synchronisation
- ✅ Settings updates
- ✅ Card lookup results
- 🔄 Chat messages (future)

**Status**: ✅ **Core real-time features implemented**

---

### 3.8 Rate Limiting
All Socket.IO events are rate-limited server-side per socket using a sliding-window counter. See `GAME_MECHANICS.md` for the full table.

**Status**: ✅ **Implemented**

---

### 3.9 Game Statistics

#### Tracked Per Player
- ✅ **Cards Played**: Total count
- ✅ **Total Movement**: Sum of `|newPileValue − oldPileValue|`
- ✅ **Special Plays**: Count of backward-10 moves
- ✅ **Nas Cheats Used**: Card-swap cheat uses

#### Statistics Display
End-game statistics modal shows:
- Overall game stats (aggregate across all players)
- Individual player stats in a table
- Average movement per card (efficiency metric)
- Game duration and turn count

**Status**: ✅ **Implemented**

---

## 4. Implementation Status Summary

### Fully Implemented Features ✅
1. Multiplayer mode (2–6 players) with Socket.IO real-time sync
2. Solitaire mode for single-player
3. Game creation with 6-character unique IDs and collision detection
4. Join game via game ID or shareable invite link
5. Deep-link auto-join when player name is already stored
6. Customisable game settings (host only)
7. Turn-based gameplay with configurable minimum card requirements
8. Backward-10 special move rule
9. Auto-refill hand option (immediate or end-of-turn)
10. Win/loss detection and game-end handling
11. Player-skipping when hand is empty
12. Comprehensive statistics tracking and end-game modal
13. Dark theme UI with visual feedback
14. Player colour assignment (red/orange/green/cyan/purple/pink)
15. Undo within turn (server-side snapshot stack, clears on end-turn)
16. Foundation pile reactions (👍 ❤️ 🔥, real-time sync)
17. Turn sequence dot strip with distance indicator
18. Backward-10 special play animation (golden flash + floating label)
19. End-game confirmation modal
20. Game ID invite link with one-click copy
21. Player kick (lobby and active game) with card return to draw pile
22. Nas Cheat ability (card swap, once per turn, for players named "nas")
23. Card lookup cheat (Ctrl+Shift+C, broadcast to all players)
24. Rate limiting on all Socket.IO events
25. TTL-based orphan room reaping
26. In-memory state storage (no external database dependency)
27. How-to-play static page (`how-to-play.html`)
28. Sound effects (card plays, special moves, turn starts, game outcomes)

### Planned Features 🔄

#### Medium Priority
1. **In-game Chat**: Real-time text communication
2. **Peek at Hands**: View others' hands (with permission)
3. **Drag-and-Drop Cards**: Enhanced card interaction
4. **Mobile Responsive Design**: Optimise for tablets and phones

#### Lower Priority
5. **Patterned Cards**: Visual card designs
6. **Achievement System**: Reward player accomplishments
7. **Game History & Replay**: Review past games

### Explicitly Not Planned ❌
- Mid-game joining (disrupts cooperative balance)
- Player authentication
- Individual win conditions (cooperative game only)
- External database / game-state persistence across server restarts

---

## 5. Architecture Details

### Client-Server Communication
```
Client  ──Socket.IO event──►  Server
                               validates move
                               updates in-memory state
                              ◄── ack callback ── requesting client
                              ──► game:updated broadcast ── all room clients
```

### Key Socket.IO Events

**Client → Server (with ack)**
| Event                 | Description                          |
|-----------------------|--------------------------------------|
| `game:create`         | Create a new game room               |
| `game:join`           | Join an existing game                |
| `game:rejoin`         | Reconnect with a new socket ID       |
| `game:lookup`         | Check if a game ID is joinable       |
| `game:listJoinable`   | List public lobby games              |
| `game:start`          | Host starts the game                 |
| `game:playCard`       | Play a card to a foundation pile     |
| `game:endTurn`        | End the current player's turn        |
| `game:undoPlay`       | Undo the last card play              |
| `game:nasCheat`       | Use the Nas Cheat card swap          |
| `game:endGame`        | Host ends an active game             |
| `game:updateSettings` | Host updates lobby settings          |
| `game:leave`          | Leave the current game               |
| `game:kickPlayer`     | Host kicks another player            |
| `game:setReaction`    | Set a pile reaction                  |
| `game:cardLookup`     | Look up where a specific card is     |

**Server → Client (broadcasts)**
| Event                   | Description                              |
|-------------------------|------------------------------------------|
| `server:ready`          | Sent on connect with assigned socket ID  |
| `game:updated`          | Full game state broadcast                |
| `game:reactionsUpdated` | Updated reaction state                   |
| `game:specialPlay`      | Backward-10 animation trigger            |
| `game:cardLookupResult` | Card location broadcast to room          |
| `game:kicked`           | Notifies a kicked player                 |

---

## 6. Quality Assurance

### Automated Testing
- Engine unit tests (Vitest) — rules and transitions
- Schema tests (Vitest) — Zod validation
- Server integration tests (Vitest) — GameManager + Socket.IO
- Client component tests (Vitest + jsdom + Testing Library)
- E2E smoke tests (Playwright)

### Manual Testing Scenarios
- Game creation and joining (direct ID, invite link, deep link)
- Card playing and turn progression
- Win/loss detection
- Player disconnection/reconnection
- Statistics calculation and display
- Settings changes by host
- Solitaire mode
- Edge cases: empty hands, draw pile exhaustion, kick during active game

---

## 7. Deployment Considerations

### Development Environment
- Client dev server: `http://localhost:5173` (Vite)
- Server dev server: `http://localhost:3001` (tsx watch)
- No external database required

### Production Requirements
- Build both client and server TypeScript (`npm run build`)
- Set `ALLOWED_ORIGINS` environment variable (required in production)
- Set `PORT` as needed (default 3001)
- Serve client static build via CDN or reverse proxy
- No database provisioning needed

---

## 8. Version History

### Current Implementation (post-v1 refactor)
- Full multiplayer and solitaire gameplay
- In-memory state storage (Firebase removed)
- Monorepo structure (packages/engine, packages/shared-types, apps/client, apps/server)
- Comprehensive rate limiting on all events
- Shared DTOs and defaults in packages/shared-types
- Comprehensive statistics, reactions, undo, kick, Nas Cheat, card lookup
- Sound effects, invite links, deep-link auto-join

---

**Document Status**: Updated 2026-03-18 to reflect current implementation

**Maintenance**: Update whenever new features are implemented, interfaces change, or defaults are modified.
