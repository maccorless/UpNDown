# Up-N-Down — Game Mechanics and Implementation Guide

## Joining a game in progress

By invitation only, and the host decides. The host makes a single-use invitation (`game:createInvite`; a link with the game code and a random token, good for 30 minutes, at most 10 waiting). Whoever opens it asks to join (`game:requestJoin`, with their name); every bad, used or expired invitation, and any game that does not exist or is not being played, is answered the same way. Only one request can wait on an invitation, and it lapses after 2 minutes. The host is asked (`game:joinRequest`) and answers (`game:resolveJoin`). Asking takes nothing from the game. On a yes the server re-checks everything (the game, the host, the table size and deck limit, the account, the invitation, the cards), deals the newcomer a full hand (or what is left) from the BOTTOM of the draw pile so what the active player draws next is undisturbed, adds them last in the seating order, issues a rejoin token, records their account, and uses the invitation up. Every other hand, every pile, whose turn it is and how far into it stay as they were. An admission that would end the game is refused. It is allowed at any time while the game is being played, clears the undo history, keeps what an account used before it was removed (a single-use cheat stays spent), and one account still holds only one seat in a game.

## Robots

The host can fill seats with robots in the lobby (`game:addRobot`, `game:removeRobot`). A robot is a seat the server plays, named after a random famous mathematician not already at the table (one word, from the list in `apps/server/src/robot-names.ts`) and marked `[Robot]`: it counts toward `minPlayers` and `maxPlayers` and the deck limit like anyone, there must be at least one person, and it has no connection, account or rejoin token. Robots play through the same rules as people. They choose with a trained network (`packages/engine/models/robot.json`, about 245,000 numbers, run in TypeScript on the server): it sees what a player at the table sees (their own hand, the pile tops, the size of the other hands, the marks on the table) plus the public list of cards already played, and never another hand or the draw pile order. It is told which seats are robots (their marks are exact and instant) and which are people (theirs may be late). For cheats (skip, trade), for a move the rules refuse, for tables the network was not built for (more than 6 players, a hand above 11, card values above 99) and on any error, the robot uses the written strategy of `strategy.ts` instead; `ROBOT_BRAIN=heuristic` switches the network off. Measured over thousands of games the network plays clearly better than the written strategy (see `docs/plans/2026-11-17-training-final-report.md`).

Next to each robot the table shows the cards it played on its last turn, in the order played: "skipped" after a skip, and nothing before its first turn. These cards are public. They stay up until the robot's next turn, because robots play too fast to follow.

Robots also **show reactions**: after every play, each robot that is not on turn marks every pile by how good its best card for that pile is (really love: a backward 10 only; love: a card within 3% of the deck of the top, 2 steps with the default deck; like: within 10.5%, 10 steps; nothing otherwise), and a robot on turn shows none, as for a person. People's marks are read by the robots. A robot waits a pause after each thing it does (every card it plays and its end of turn, not once per turn), so a pause in which the others can react before it plays (0.8 to 1.6 seconds at a table with a person unless the host chose another in the table settings, `robotPauseMs`: 0.1, 0.4, 0.8, 1.5 or 3 seconds, each plus up to as much again at random; 150 ms at a table of robots only, whatever the host chose; the server defaults are `ROBOT_PAUSE_MS`, `ROBOT_PAUSE_JITTER_MS` and `ROBOT_PAUSE_ROBOTS_ONLY_MS`), and it reads the marks on the table at the moment it plays. The turn is planned and names the exact moment it was planned for, so a step planned for a moment that has passed does nothing. Robots only act while a person is connected; with every person away they wait, and after the kick time (90 seconds) a game with robots and nobody left is over, recorded as abandoned for each signed-in person (if a card was played in it). They cannot be kicked, are skipped when the host seat is lost (only a person can take over), and no result is recorded for them (the player count still includes them).

## Cheats

Each cheat is off, once (one use per player per game) or unlimited, set per game (`cheatLimits`). Cheats are used before the game ends, never to rescue a lost game, and none can be undone.

- **Card seeker (`lookup`)**: ask where a card is. Only the asker is told; everyone else is sent `game:cheatUsed` (who and which cheat, nothing about the card). Hotkey Ctrl/Cmd-P.
- **Card seeker, outside the game**: a card that is not one of the game's cards (for example 65 in a game of 2 to 59) is answered as outside the game. It is not counted as a use.
- **Nas check (`nas`)**: the card seeker's check, for a player whose name is Nas (any capitals, spaces at the ends ignored). A second player with the same name is renamed Nas-1 and keeps the check. It has no setting of its own: it is on, unlimited, whenever the game has another cheat on, and it is not listed in Settings or the cheat summaries. Each check also counts as a lookup. Nobody else is told it was used. Hotkey Ctrl/Cmd-Shift-K. Solitaire has no player name, so there is no Nas check in solitaire.
- **The Full Monty (`monty`)**: a grid of every card from 1 to 100, colored by where each card is: in the draw pile, in your hand, in another player's hand, on top of a pile (hatched), or played to a pile and no longer on top (a pile keeps only its top card, so played cards are the ones in neither the draw pile nor a hand). The grid is ten by ten, so a card and the one ten above or below it share a column. Cards outside the game's range are gray. Only the one asking sees the grid; the others are told one was used. Its limit is set in Settings like the others, and it works in solitaire too. Each use also counts as a lookup. Hotkey Ctrl/Cmd-Shift-M.
- **Skip (`skip`)**: on your turn, before playing a card, pass without the minimum. Not offered in solitaire. No refill. A full round of skips with no card played by anyone ends the game as a loss. Ctrl/Cmd-S, with a confirmation.
- **Trade (`trade`)**: swap a hand card for the next draw card; the card you give goes back into the draw pile at a random position. Active player only. Ctrl/Cmd-Shift-X.
- **Hint (`hint`)**: suggests the best play (or to end the turn, skip or trade) from what the asker can see: their own hand, the pile tops, the size of the draw pile and of the other hands, never the cards in the draw pile or other hands. Only the asker sees it, nobody is notified, it is counted in the statistics. Hotkey Ctrl/Cmd-Shift-H. Worked out by the server in multiplayer (`game:hint`) and in the browser in solitaire. With the screen-only network (`packages/engine/models/hint.json`, which has no access to the played-card record) the answer comes with a headline and one to three reasons a player can check: the size of the move, a backward 10, which of your cards it leaves able to follow, cards it would strand, what a teammate has marked, or, when none of those explains the move, a plain statement that the trained model weighs the whole hand. In solitaire the network file is fetched once, the first time a hint is asked for (it carries no data); with no connection, or on any error, the written strategy gives the hint without reasons, as before. Skip and trade suggestions always come from the written strategy. `HINT_BRAIN=heuristic` switches the network off.
- **Auto-mark piles** is a player setting, not a cheat: it has no limit and nothing is counted. Tables only (never in solitaire, where nobody can react to the player). While it is on for a person, the server marks every pile for them, like, love or really love, by the same rule the robots use (`senderLevel`), after every play; a person on turn shows no marks, and switching it off takes their marks down. The client keeps the choice on the device (`upndown.autoMark.v1`) and tells the server through `game:setAutoMark` (payload `{ gameId, enabled }`, only while a game is being played; nobody else is told); the switch is stored on the player as `autoMark` and survives a rejoin.
- Skip and trade clear the undo history. A lookup or hint is not refunded by undo, and an undo does not change the auto-mark switch.
- The panel opens by double tapping the logo or from the Cheats button; the keys are accelerators only. On a phone there are no keys: the Cheats button shows on the board while the game has a cheat that can still be used, and Settings says so under Cheats.

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

**Statistics tracking**: Backward-10 moves are counted as "special plays" in game statistics. A backward 10 played when no card in the hand, the card played included, had a normal play on either pile is also a **lifeline** (the Lifeline badge, and "Lifeline!" on the flash).

### Card Distribution

**Configurable parameters** (set by host in game settings):
- Card range: Default 2–99 (configurable)
- Hand size: Default 7 cards (configurable, UI range 5–11). The deck is checked against it: a table never holds more players than the deck can deal a full hand to (cards in deck divided by hand size), settings that cannot deal the minimum table are refused, and the game refuses to start rather than deal uneven hands
- Min cards per turn: Default 2 (configurable, range 1–3)
- Draw pile: Contains all remaining cards after initial deal

**Default configurations**:
- Multiplayer (2–6 players): 7 cards per player, no auto-refill
- Solitaire: 8 cards in hand, one card a turn at least, cards 2 to 59, auto-refill always on (the Easy preset). Normal (7 cards, two a turn, 2 to 99) and Hard (6 cards, three a turn, 2 to 99) are one choice away in Settings

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
- Undo is server-authoritative in multiplayer (snapshots are recorded only for plays the engine accepts, capped at 100); client-side in solitaire
- Statistics are rolled back with the play, except what cannot be taken back: cheats used, pile marks placed, and the undo itself (each player's `undosUsed` goes up by one for the player who undid). One engine function, `carryAfterUndo`, does this for the server and for solitaire.

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

**Closing the browser mid-game.** This browser keeps the player's seat for up to two hours. A player with a seat in a game still being played sees **Rejoin game CODE** on the front page and at the top of the Multiplayer screen. Clicking it takes the seat back if the server still holds the game. The server holds a game for 30 minutes after its last move when nobody is connected. If every person at the table is signed in, it holds the game for a week instead, so a group can play across several days, and robots do not end such a table. A table with a guest in it keeps the 30 minutes, and a guest table with robots ends 90 seconds after its last person goes. A seat is kept only in the browser that held it, for two hours (a week when signed in). The front page offers a saved seat only when the server still holds it (`POST /api/seat-check`), so a seat whose game is gone, or that the host removed, is not offered. Another browser or device needs a signed-in account to take the seat back.

---

### Solitaire Mode

Choosing Solitaire opens a setup step, not a game: it shows the settings the next game will have (cards, hand size, cheats), with **Start Solitaire** and **Change settings**. Settings can be changed there and are fixed once a game is dealt (the Settings button then shows them view only). The setup step also lists your own settings (sound effects, pile arrows), and the multiplayer start screen shows the table settings and yours the same way. After a game ends, **Change settings** ends it and opens the settings, **Play Again** deals another with the same settings, and at a table any player still there can start it. Back to Lobby returns to the home page (at a table, only the host can take it back to the lobby).

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
1. Click your reaction slot above or below any pile (only available when it is NOT your turn)
2. Cycles: **None** → **Like** (👍) → **Love** (❤️) → **Really Love** (🔥) → **None**
3. Your reactions clear automatically when YOUR turn starts
4. All players see everyone's reactions in real time
5. Robots mark piles themselves after every play (see Robots); a mark means "I hold a great card for this pile", and a mark is only worth acting on while it is current
6. A mark placed by hand is credited (the Called It badge) for each play a teammate makes on that pile while the mark is up. Auto-mark and robot marks earn no credit, and an undo takes the credit back. A robot counts as a teammate, so a robot that plays on a pile a person marked by hand gives that person the credit, because the robots read the marks

**Player slot positions**:
- Top row, above each card: Players 1–3 (by join order)
- Bottom row, below each card: Players 4–6 (by join order)

### Pile Arrows (per game, default on)

When the player's own *Pile arrows* setting is on (default; kept on the device as `upndown.arrows.v1`, so each player chooses for themselves), each foundation pile shows one arrow on each side of its card: up for an ascending pile, down for a descending pile. The direction is carried by the arrow shape, not by color. The arrows stay visible; they do not fade.

- The pile's text tag ("Ascending"/"Descending") and its rule hint (for example "<100 or 110") are no longer shown on screen. The pile's name is still announced to screen readers.
- The backward-ten rule is not shown on screen. Players learn it from play.
- Turning the setting off hides the arrows for everyone in that game.

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
  handSize: number;          // Default: 7  (UI range 5–11)
  minPlayers: number;        // Fixed at 2 (multiplayer); not shown in the settings UI
  maxPlayers: number;        // Default: 6  (multiplayer)
  minCardsPerTurn: number;   // Default: 2  (range 1–3)
  autoRefillHand: boolean;   // Default: false (multiplayer), true (solitaire)
  allowUndo: boolean;        // Default: false
  privateGame: boolean;      // Default: false
  allowCardLookup: boolean;  // Default: false. Old switch for the card seeker; read as `unlimited` when cheatLimits is absent
  cheatLimits?: Record<'lookup' | 'skip' | 'trade' | 'hint', 'off' | 'once' | 'unlimited'>;  // Default: all off
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
                      game:updated  ──► all clients in room (each gets its own view)
```

**Hidden information:** every `game:updated` and every ack carries a per-recipient view. A player receives their own hand in full. Other players' hands and the draw pile are sent as same-length placeholder cards (`value: 0`), so counts are visible but cards are not. The secret card lookup (Shift) is answered by the server in the asker's ack only.

**Rejoin ownership:** `game:create`, `game:join` and `game:rejoin` acks return a per-seat `rejoinToken`. `game:rejoin` requires `{ gameId, previousPlayerId, rejoinToken }`, rotates the token on success, and removes the old socket from the room. The token is never part of broadcast state. A refused rejoin says why in `reason`: `kicked` when the host removed the seat, `gone` for anything else (the game is no longer kept, a wrong token, or the seat already taken back). A failure with no reason may be retried.

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
| `game:playAgain`     | 10    | 30 s    |
| `game:lookup`        | 20    | 10 s    |
| `game:listJoinable`  | 30    | 10 s    |
| `game:start`         | 10    | 30 s    |
| `game:playCard`      | 60    | 10 s    |
| `game:createInvite`  | 10    | 30 s    |
| `game:requestJoin`   | 5     | 30 s    |
| `game:resolveJoin`   | 20    | 10 s    |
| `game:addRobot`      | 10    | 10 s    |
| `game:removeRobot`   | 10    | 10 s    |
| `game:skip`          | 10    | 10 s    |
| `game:trade`         | 10    | 10 s    |
| `game:hint`          | 20    | 10 s    |
| `game:setAutoMark`   | 10    | 10 s    |
| `game:endTurn`       | 30    | 10 s    |
| `game:undoPlay`      | 30    | 10 s    |
| `game:endGame`       | 10    | 30 s    |
| `game:updateSettings`| 20    | 10 s    |
| `game:leave`         | 10    | 30 s    |
| `game:kickPlayer`    | 10    | 10 s    |
| `game:setReaction`   | 20    | 10 s    |
| `game:cardLookup`    | 10    | 10 s    |

Limits are per socket. `game:lookup` and `game:join` are also limited per client IP (60 and 30 per 10 s), because reconnecting resets a socket's bucket and the game id is the only secret for private games.

### Statistics Tracking

**Tracked per player**:
- **Cards Played**: Total count
- **Total Movement**: Net progress of the piles: each play adds how far it moved the pile in its own direction, so a backward 10 subtracts 10. The team total equals the sum of how far each pile ended from its start.
- **Special Plays**: Count of backward-10 moves
- **Cheats Used**: skips, trades, card lookups and hints, counted per player and shown on the end screen (the old Nas swap count is read as trades)
- **Lifelines** (`lifelines`): backward 10s played when no card in the hand had a normal play. An undo takes one back, like the other per-play counts. The end screen names who had the most.
- **Marks followed** (`markFollows`): one for each play by a teammate on a pile this player had marked by hand while the mark was up. An undo takes it back. The end screen names who had the most.
- **Undos** (`undosUsed`) and **pile marks placed** (`marksPlaced`): counted per player and not refunded by an undo. They feed the profile badges, not the end screen. A mark is counted when it is placed or changed to a reaction, not when it is cleared.

**Aggregate** (in `GameStatistics`):
- `turns`: Total turns completed
- `startedAtMs` / `endedAtMs`: Wall-clock timestamps
- `finishedById`: the player whose card play won the game. Set only by a winning play (never by ending a turn or a removal), and left unset for a loss. It follows the seat if the player reconnects under a new id.

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
- **Backward-10 flash**: Golden flash animation + floating "🔥 ±10! 🔥" label, or "🔥 Lifeline! 🔥" for a lifeline. Robots' backward 10s flash for everyone too
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

**Last Updated**: 2026-11-23
**Version**: Current implementation (post-v1 refactor)
**Status**: Accurate — update whenever interfaces or defaults change
