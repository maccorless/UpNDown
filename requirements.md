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
- **Setup step**: choosing Solitaire does not deal a game. It opens a step that lists the settings (cards, hand size, cheats) with Start Solitaire and Change settings. The settings are editable there and are fixed once a game is dealt; the end-of-game screen has Change settings (it ends the game and opens the settings), Play Again (same settings) and Back to Lobby
- Continuous play — no turn structure
- `autoRefillHand` always `true`
- No minimum card requirement
- **No connection needed**: solitaire is played, saved and resumed entirely in the browser. The server is involved only to sign in, and, when a signed-in player finishes a game, to save its result
- **Save and resume (this device only)**: once a card has been played, the game is saved in this browser after every move, with its undo history, under its own key. Any number of games can be going at once (for example one per tab): "Solitaire" always starts a new game and never discards a saved one. The landing lists each saved game that no other tab has open (cards left, how long ago it was saved) with Continue, which puts you back exactly where you were, and Discard, which asks first. At most 5 unfinished games are kept, none for over 30 days. A save is removed when its game is won or lost or you press End Game. Saves never go to the server and do not follow an account to another device. Time away is not counted as time played
- **Result for signed-in players**: a finished solitaire game (won or lost, never one ended early) is saved to the player's private history, once, even if sent again, up to 5,000 saved solitaire games per account (after that the save is refused as "history full"). The end screen says "Saved to your history.", or offers Try again if it could not be sent. A guest's solitaire never touches the server
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
- Multiplayer undo is server-authoritative (snapshot stack in `GameRoom`, recorded only for accepted plays, capped at 100)
- Solitaire undo is client-side
- Requires `allowUndo: true` in settings (disabled by default)
- **Status**: ✅ **Implemented**

#### Player Kick (Lobby & Active Game)
- Host can remove any other player at any time (lobby or active game)
- Kicked player's cards are returned to the draw pile (shuffled in). When hands refill as cards are played (`autoRefillHand`), hands are topped up from it and the game is re-checked for a win (only possible with the draw pile empty) or a stuck active player
- A player whose connection drops keeps their seat, and their hand, for the rest of a live game. After 10 seconds every other player is told who is reconnecting. After 90 seconds the host is offered a kick (or to keep waiting), and kicking a player who has been gone less than 90 seconds is refused ("may still reconnect"). If the host is the one gone for 90 seconds, the next available player (the next connected player after the host in seat order) is offered the kick and, on kicking the old host, becomes host. Nobody else may kick the host, and only a host gone 90 seconds may be kicked by a non-host. Not after the game has ended, and never yourself. A connected player can be kicked by the host at once. A kicked player cannot rejoin the seat. A kick during a live game records an `abandoned` game for the kicked player's account (a quit); the others still get the team result
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
- Each player has a fixed slot per pile (players 1–3 in the top row, 4–6 in the bottom row, above and below the card)
- Reactions reset when the player's turn starts
- Cannot set reactions during your own turn
- Robots mark piles automatically after every play, by how close their best card for the pile is (really love: a backward 10 only; love: within 3% of the deck; like: within 10.5%), and read everyone's marks
- **Status**: ✅ **Implemented**

#### Foundation Pile Arrows
- When `showArrows` is on (default), each pile shows one arrow on each side of its card: up for ascending, down for descending
- The arrows stay visible for the whole game; they do not fade
- The pile's text tag and rule hint are not shown on screen; the backward-ten rule is learned through play
- Turning `showArrows` off hides the arrows for every player in that game
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
- **State Storage**: In-memory `Map` with TTL-based orphan reaping; games being played are also saved to Postgres where a database is connected
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
- **Player Names**: a new player starts with a random name made of a US president's first and last name (for example "Donald Washington"), kept in `localStorage` for guests, and can type their own at any time. In a game a generated name is shown as first name and last initial ("Donald W"); a name someone typed is never shortened. Signed-in players have the name stored on the account and the landing field follows it, so edits are saved
- **First sign-in name prompt**: the server hands every account a random name, but it only becomes the player's own once they say so. On first sign-in a dialog asks "Input your player name or accept a random one": a field holding the suggestion (selected), a shuffle button for another random name, a line showing how other players will see it ("Grover A"), and Continue. It cannot be dismissed with Esc the first time. Accounts that existed before this are asked once. Signed-in players can reopen it from "Change name" on the landing screen
- **Name collisions (multiplayer)**: names are compared as shown, ignoring case. The first player to take a name keeps it; the next gets `-1`, then `-2`, and so on (`Abe`, `Abe-1`, `abe-2`; `Donald W`, `Donald W-1`). A name is freed when its owner is kicked
- **Cheat limits and counters**: every cheat (card seeker `lookup`, `skip`, `trade`, `hint`) has a per-game limit setting `cheatLimits` of off, once (one use per player per game) or unlimited; absent means off, except that the old `allowCardLookup` switch still means the card seeker is unlimited when no `cheatLimits` is given, and the server writes both forms. Each player's statistics count `skipsUsed`, `tradesUsed`, `lookupsUsed` and `hintsUsed` (the old `nasCheatsUsed` is read as trades in saved games). Stored result rows carry `my_skips`, `my_trades`, `my_lookups`, `my_hints` (migration 003); `my_nas_cheats` keeps older counts and a trade count is `my_trades + my_nas_cheats`
- **Multiplayer results (signed in)**: when a multiplayer game is won or lost, each signed-in player gets a private history row with the team result and their own counters (cards played, net movement, backward 10s, Nas cheats), plus game length, turns, player count and the settings used. Co-players are not stored, only how many there were. Guests get nothing. If the host ends a game that is still being played, only the host gets an "abandoned" row; other players are unaffected, and ending a finished game records nothing. Every start of a room is its own game, and a result is never written twice. Recording is best effort: a database problem never slows or breaks play
- **Settings sync (signed in)**: solitaire and multiplayer settings, sounds and the player name follow the account across devices. The first sign-in on a device takes the account's settings when it has any, otherwise uploads the device's; after that changes are saved automatically (last write wins). Guests keep everything in the browser as before
- **Landing screen**: a large wordmark (Up in the ascending-pile teal, Down in the descending-pile coral), a one-line tagline, two mode cards (Solitaire, and Multiplayer as the single primary) and, under them, either the optional Google sign-in with its reason or a welcome line with Change name. The entrance animation plays once per page load and not under reduced motion
- **Guests need no account**: every feature works without signing in
- **Optional Google sign-in** (only where `DATABASE_URL`, `PUBLIC_BASE_URL`, `AUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set and the database answers; off on Skiff and local runs without them): a card on the landing screen offers "Continue with Google". Only the Google account id is stored, never an email. A signed-in browser stays signed in for 90 days of use (capped at one year). Sign-in is a full-page redirect and sign-out is unavailable while in solitaire or seated in a multiplayer lobby or game. New accounts have empty settings; statistics, saved settings and history are later phases (see `docs/design/login-and-profiles.md`)
- **Status**: ✅ **Implemented** (guest play); ✅ sign-in and sign-out (phase 2 of the login design)

---

### 3.4 Game Session Management

#### Game Creation & Joining
- **6-character unique game ID** (A–Z, 0–9) for each game
- Collision detection with up to 20 retry attempts
- Host creates game and controls when to start
- Other players join via game ID or shareable invite link (`?game=XXXXXX`)
- **Games survive a restart**: where a database is connected, games being played (not lobbies or finished games) are saved to the `live_games` table and put back when the server starts, with every seat treated as a dropped connection, so the usual notice, kick and take-over rules apply and each player takes their seat back with the saved token or, signed in, by account (`game:mySeats` lists the games an account holds; with several the player chooses). Saving is a sweep every 2 seconds, never in a move's way; a new seat credential is saved before it is handed over; tokens are stored only as hashes. One process writes at a time (a Postgres advisory lock on its own connection, plus a version on every write). A game untouched for 24 hours is deleted; without saving the limit stays 30 minutes. The page says so when saving is unavailable (`storage` on `/api/auth/config`: `none` for a version with no database, `down` when it is not answering, with a retry every 15 seconds)
- **Joining a game in progress**: by invitation only. The host's Invite button makes a single-use link (30 minutes); whoever opens it asks to join and waits; the host is asked and must say yes. On a yes the newcomer is dealt a hand from the bottom of the draw pile at any time during play, and nothing else changes (no other hand, no pile, not whose turn it is). Refused if the table or the deck is full, the account already has a seat, the invitation is spent or expired, or dealing would end the game. See GAME_MECHANICS.md
- **Robots**: the host can add robots in the lobby (they count toward the player limits, with no cap of their own, and at least one person must stay). The server plays them with a trained network (the written strategy for cheats, errors and tables outside what the network handles), through the same rules, a moment apart, and only while a person is connected; with every person away they wait, and after 90 seconds the game is over (abandoned for each signed-in person). Robots are named after famous mathematicians (a random name nobody at the table has), cannot be kicked, never take the host seat or an account's result, and are listed as [Robot]
- **One seat per account**: a signed-in account cannot join a game it already has a seat in ("Your account is already in this game (perhaps in another tab)"). Two different accounts, for example in two tabs of one browser, are two players, and guests are never matched with each other. A guest seat that comes back signed in as an account already seated in that game is not credited to it
- **One game per connection**: a connection can be in one game at a time. Starting or joining another game leaves a lobby or a finished game it was still seated in; a game that is being played cannot be left, so it refuses with "You are already in a game that is still being played"
- **Limits**: at most 500 rooms exist at once ("The server is full right now" beyond that), and the public lobby list shows the 50 newest
- Deep-link auto-join: joins at once only for a player who has already chosen a name (edited it, used it to host or join, or saved one before generated names existed). A first-time visitor, who only has a generated name, sees the join screen with the game id and name filled in and joins with one tap. Typing a name never joins by itself
- **Status**: ✅ **Implemented**

#### Game Settings (Configurable by Host)
| Setting          | Default | Multiplayer Range | Notes                           |
|------------------|---------|------------------|---------------------------------|
| minCardValue     | 2       | 2–99             | Must leave ≥18 card deck size   |
| maxCardValue     | 99      | 2–99             |                                 |
| handSize         | 7       | 5–11             | A table is capped at the players the deck can deal a full hand to (cards in deck divided by hand size) |
| minPlayers       | 2       | fixed at 2       | Not shown in the UI; the host can start once 2 players have joined |
| maxPlayers       | 6       | 2–6              |                                 |
| minCardsPerTurn  | 2       | 1–3              | Final stage always 1            |
| autoRefillHand   | false   | on/off           | Always on in solitaire          |
| allowUndo        | false   | on/off           |                                 |
| privateGame      | false   | on/off           | Hides from public join list     |
| allowCardLookup  | false   | on/off           | Old card seeker switch; `cheatLimits` (off, once, unlimited per cheat) replaces it |
| showArrows       | true    | on/off           | Up/down arrow each side of pile card |

Settings dialog: Difficulty presets (Trivial/Easy/Normal/Hard, with a Custom state), Cards (highest card slider, hand size, cards per turn, auto refill, lowest card under Advanced), Players (maximum, private game), pile arrows and the card-lookup cheat. Non-hosts and in-game viewers see a read-only summary. Sound effects are a per-device preference, not a game setting.

- **Status**: ✅ **Implemented**

---

### 3.5 Disconnection Handling
- **Lobby**: Disconnected player is auto-removed from the game; host transfers if needed
- **Active Game**: Player remains in the game state; reconnection restores them via `game:rejoin`. A refused rejoin carries `gone: true` when the seat no longer exists (a rate-limit refusal does not), and only then is the player told they were removed. The browser keeps the game code, player id and rejoin token in local storage (one `upndown.seat.<key>` entry per seat) while a game is being played (cleared when it ends or the player is removed, ignored after 2 hours), and the landing page shows a "Rejoin game ABC123" button for each such seat that no other tab is using; clicking it takes the seat back. A new tab can host or join a different game while a seat is saved, and is treated like another browser except that it may pick up what is left behind. Tabs mark what they are using with Web Locks, which the browser releases when a tab closes; where Web Locks are missing a tab may be offered a game another tab has open. A signed-in player with nothing saved (another device, cleared storage) is put back by account when they open multiplayer: the client sends `game:rejoinMine`, and the server finds a seat in a game being played that was taken with that account. Solitaire never does either Others are told after 10 s, and kick or host takeover is offered after 90 s (see Player Kick). A rejoin refused because the seat was removed returns the player to the home screen with a message
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
  - ✅ Cheats panel (double tap the logo, or the Cheats button) with card seeker, skip and trade, each off, once or unlimited
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
- ✅ Card lookup results (private to the asker; others are told a lookup happened)
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
- ✅ **Total Movement**: Net progress along each pile's direction (a backward 10 counts as −10); the team total equals how far the piles ended from their starts
- ✅ **Special Plays**: Count of backward-10 moves
- ✅ **Cheats Used**: skips, trades, card lookups and hints per player

#### Statistics Display
End-game statistics modal shows:
- Overall game stats (aggregate across all players)
- Individual player stats in a table
- Average movement per card (efficiency metric)
- Game duration and turn count
- Win or loss banner; a loss states how many cards were left (worded "so close" only within a tenth of the deck)
- Callout naming the player(s) with the most backward 10s
- Win splash shows confetti, hidden when the system asks for reduced motion

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
22. Trade cheat (swap a hand card for the next draw card; replaces the name-gated Nas swap)
23. Hint cheat (a trained network that sees only what a player can see, with the written strategy as the fallback; the suggested card and pile are lit up with the advice in words and up to three reasons), card seeker cheat (Ctrl/Cmd-P; the answer is private; others are notified), skip cheat (Ctrl/Cmd-S), cheats panel and notices
24. Rate limiting on all Socket.IO events
25. TTL-based orphan room reaping
26. In-memory state storage, with saving of games in progress to Postgres where one is connected
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
- Required accounts (sign-in stays optional)
- Individual win conditions (cooperative game only)
- Game-state persistence across restarts where no database is connected (the Skiff version)

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
| `game:rejoin`         | Reconnect with a new socket ID (requires the seat's rejoin token) |
| `game:rejoinMine`     | Signed-in player takes back a held seat by account (no payload) |
| `game:lookup`         | Check if a game ID is joinable       |
| `game:listJoinable`   | List public lobby games              |
| `game:start`          | Host starts the game                 |
| `game:playCard`       | Play a card to a foundation pile     |
| `game:endTurn`        | End the current player's turn        |
| `game:undoPlay`       | Undo the last card play              |
| `game:skip`           | Skip your turn (cheat; before playing a card) |
| `game:trade`          | Trade a hand card for the next draw card (cheat) |
| `game:hint`           | Ask for a hint (cheat; the answer is private and counted) |
| `game:createInvite`   | Host makes a single-use invitation to a game in progress |
| `game:requestJoin`    | Ask to join a game in progress with an invitation (the host decides) |
| `game:resolveJoin`    | Host lets a requester in, or declines |
| `game:addRobot`       | Host adds a robot to the lobby |
| `game:removeRobot`    | Host removes a robot from the lobby |
| `game:endGame`        | Host ends an active game             |
| `game:updateSettings` | Host updates lobby settings          |
| `game:leave`          | Leave the current game               |
| `game:kickPlayer`     | Host kicks another player            |
| `game:setReaction`    | Set a pile reaction                  |
| `game:cardLookup`     | Look up where a specific card is (answers only the asker) |

**Server → Client (broadcasts)**
| Event                   | Description                              |
|-------------------------|------------------------------------------|
| `server:ready`          | Sent on connect with assigned socket ID  |
| `game:updated`          | Per-recipient game state (own hand only; others' hands and draw pile are placeholders) |
| `game:reactionsUpdated` | Updated reaction state                   |
| `game:specialPlay`      | Backward-10 animation trigger            |
| `game:cheatUsed`        | A player used a cheat: who and which kind, never what it found |
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
- Comprehensive statistics, reactions, undo, kick, cheats (skip, trade, card seeker)
- Sound effects, invite links, deep-link auto-join

---

**Document Status**: Updated 2026-03-18 to reflect current implementation

**Maintenance**: Update whenever new features are implemented, interfaces change, or defaults are modified.
