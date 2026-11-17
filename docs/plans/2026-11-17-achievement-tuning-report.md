Created: 17-Nov-2026 23:55 IST

# Achievement thresholds: what was measured and what is judgment

Measured on 17-Nov-2026 with the engine's own strategy (`playGame`, no cheats, no reactions, seeds 1000 to 1299, 300 games each). The strategy is a proxy for a good, patient player. It is not an average player, so treat each win rate as an upper bound for a person.

| Table | Won |
|-------|-----|
| Solitaire, default deck (2 to 99), hand 7 | 0.0% |
| Solitaire, hand 5 | 0.0% |
| 2 players, hand 5 | 0.0% |
| 4 players, hand 5 | 0.3% |
| 4 players, hand 7 | 21.0% |
| 6 players, hand 7 | 19.0% |
| 6 players, hand 5 | 0.7% |

## What this changed

- **Speedrunner** was "standard settings, solitaire". The default solitaire deck is almost never won, so the badge could not be earned. It now counts a win at the standard difficulty (hand 7, 2 cards a turn, cards up to 99) at **any table size**, with no cheats used.
- **Light Packer** (win with a hand of 5) is nearly impossible on the default deck (0.3% to 0.7% for the strategy), so Gold at 20 wins is only reachable on easier decks. The badge looks at the hand size only, not the deck, so a player who picks a smaller deck can earn it. That is a feature of how settings work, not a bug; it is noted here so nobody is surprised. Thresholds stay 1 / 5 / 20.
- **Full Table** (win with 6 players) is about as hard as 4 players on the default deck (19% against 21%), so Bronze 1, Silver 5, Gold 20 stand.

## Not measured, so judgment

- **Time Machine** (backward 10s in one game, 3 / 6 / 10): simulated games do not record backward 10s per game, and changing the simulator for one badge was not worth it. Kept at 3 / 6 / 10.
- **Speedrunner times** (10, 7 and 5 minutes) and the **Marathon length** (over an hour): the simulator has no human pacing. These are guesses. Decision for the owner after real games exist: look at the fastest real wins and lower the thresholds (thresholds may only go down after release).
