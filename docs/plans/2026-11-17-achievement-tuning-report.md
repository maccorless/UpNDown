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

## Addendum, 23-Nov-2026: re-measured

Measured with `npm run sim --workspace @upndown/engine -- play --setting <name> --games 2000` (the engine's strategy, no cheats, seeds 1 to 2000). The 17-Nov solitaire row above is stale: the pair rule (18-Nov) made the strategy stronger, so the default normal solitaire now wins 5.0%, not 0.0%.

| Table | Won | Lifelines per player a game |
|-------|-----|-----------------------------|
| Solitaire, trivial (29 cards, hand 9, one card a turn) | 100.0% | 0.000 |
| Solitaire, easy (59 cards, hand 8, one card a turn), the new default | 100.0% | 0.000 |
| Solitaire, normal (99 cards, hand 7, two a turn) | 5.0% | 0.198 |
| Solitaire, hard (99 cards, hand 6, three a turn) | 0.5% | 0.184 |
| Two players, default deck | 15.5% | 0.107 |
| Four players, default deck | 32.5% | 0.044 |

The lifeline column uses the rule as it now stands: the card played counts toward "no normal play". A first run that left the played card out gave higher numbers (0.07 to 0.2 at the tables) and was wrong. The win rates did not change, because the rule only changes the count.

What this changed:

- **Solitaire default** moved to the Easy preset, because a first game at Normal was lost 95% of the time. Easy is a pushover for the strategy (100%). The gap between Easy and Normal is the real problem, and no preset sits in it.
- **Training benchmark** stays on Normal (`normalSolitaireSettings`), so the stage 3 solitaire table and the trained results do not move.
- **Speedrunner** still means the standard settings (7 cards, two a turn, up to 99), which is Normal. A game played on the new default does not count toward it.
- **Lifeline** thresholds 1, 5, 20 are unchanged from the first choice, but the measured rate is lower than assumed. At four players it is about 0.04 a player a game, so Bronze is roughly 25 table games and Gold roughly 450. At normal solitaire it is 0.2. **At the new Easy default the strategy never needs a lifeline, so it cannot be earned in a default solitaire game.** Thresholds are not released yet, so they can still move; I left them, and the call is yours.
- **Called It** thresholds 1, 10, 50 are not measured. The simulator places no human marks.
- **Duet** now has a measured two-player default (15.5% won), so it is reachable but not easy.
- **Strategy guide** (`docs/strategy/strategy-guide.md`) still calls the default settings Normal. It was not changed here.

Thresholds still only go down after release.
