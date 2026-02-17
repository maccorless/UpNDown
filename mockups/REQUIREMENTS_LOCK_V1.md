# UpNDown Requirements Lock (v1)

## Locked Decisions

1. Feature staging
- v1: core gameplay + responsive UI.
- v2: undo, pile preferences.
- v3: mid-game join, disconnect lifecycle handling, reconnect token recovery policy, host kick tools.

2. Modes
- Multiplayer: 2-6 players in v1.
- Solitaire: exactly 1 player.

3. Gameplay rules
- Card values: 2-99 inclusive.
- No suits/jokers.
- Four foundation piles: 2 ascending, 2 descending.
- Backward-10 special rule enabled.

4. Turn rules
- `minCardsPerTurn` is a host setting in range 1-3.
- If draw pile is empty, required minimum is always 1 regardless of setting.

5. Deck/setting constraints
- Card range and settings must ensure at least 18 cards in deck.
- Hand size is host-configurable in range 5-9.
- If deck size is insufficient for a full initial deal (players * hand size), deal all available cards round-robin and start gameplay.

6. Session and identity
- Anonymous users only (join by game key; no auth).
- Durable multiplayer persistence and reconnect behavior are deferred to v3.
- If reconnect token is lost (v3), only host kick can free seat; no identity recovery.

7. Refill behavior
- Multiplayer: auto-refill is a host setting.
- Solitaire: auto-refill is always ON.

8. UX
- Responsive from day 1, fully playable on phone.
- Multiplayer lobby includes host-editable v1 settings before create:
  - hand size (5-9)
  - min cards per turn (1-3)
  - min players (2-6)
  - max players (2-6)
  - auto-refill toggle
  - min/max card value (2-99)
- Main game shell includes a Settings button in the upper-right that opens a settings dialog in both multiplayer and solitaire modes.
- In an active multiplayer room, only game master (host) can edit settings; all other players see display-only settings.
- Host can edit room settings only while game is still in lobby phase.
- Only the host can start a multiplayer game.
- If a client is no longer mapped to any player seat for an active multiplayer game, UI shows a clear session-not-attached state with return-to-lobby action (not a blank waiting board).
- Client-side settings form must reject invalid settings before game creation, but must allow under-dealable configurations (partial initial deal rule).
- Settings dialog fields include a blue info icon with hover text explaining the field and whether increasing the value makes the game easier or harder.
- In solitaire mode, non-applicable settings fields are shown but grayed out/read-only.
- Player hand cards are always automatically sorted by value (no manual sort control).
- Newly dealt cards are visually indicated with a very light gray background until the next draw event.

9. Deferred scope
- 8-player multiplayer support is deferred to v3 or later.

## v2 Undo Requirements (Locked)

1. During active turn (current player)
- If a player has played a card and has not ended their turn, they can click that played card on the foundation pile to return it to their hand.

2. Post-turn undo window
- After a player ends their turn, if `allowUndo` is enabled in settings, an Undo button appears.
- Undo applies only to the immediately previous player's completed turn.
- Undo remains available only until the next player completes their turn.

3. Depth
- Single-level undo only.
- No multi-step undo history.

## Suggested v1 Scope

- Lobby create/join/start with game key.
- Host settings editor (constrained inputs).
- Turn-based multiplayer with server-authoritative rules.
- Solitaire local engine (client-side) sharing core game logic package where possible.
- Real-time multiplayer updates.
- Win/loss detection.
- Phone-first responsive playfield with desktop enhancements.
