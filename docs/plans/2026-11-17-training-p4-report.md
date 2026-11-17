Created: 17-Nov-2026 08:22 IST

# Training mode, phase P4 report: distilling the network into rules

Plan section 5.5. The plan's bar for continuing is a rule list within 5% of the network's measured gain over the written strategy. **That bar was not met**, so no rules file replaces `strategy.ts`; the guide (`docs/strategy/strategy-guide.md`) is built from the written strategy's own rules, measured.

## What was tried (all on validation seeds; code in `tools/training/distill*.py`)

1. **Decision tree on candidate-move features** (move size, backward 10, cards jumped, cards stranded, cards fitting afterwards, regret against the smallest move, pile room, context), learned from the network's choices on positions the tree itself reached (DAgger). Depth 8: solitaire 47.0, two players 73.1, four players 83.9, below the written strategy (50.9 / 76.0 / 88.6).
2. **Linear score over the same features plus a stop tree**, fitted to the network's move scores. Solitaire 49.6, two players 75.9, four players 87.8: the written strategy's level, not the network's (57.9 / 83.6 / 93.8 for that network).
3. **Gradient-boosted trees on the same features** did no better, so the features are the limit, not the model.
4. **Diagnostics.** With the network choosing the move and the small tree choosing when to stop, the student almost matches the network (58.9 / 81.9 / 90.9). With the network deciding when to stop and the linear score choosing the move, it does not (47.2 / 76.2 / 90.4). So the network's edge is **which card it plays**, not when it stops (stopping explains about 2.6 points with four players and none in solitaire).
5. **The network usually plays the smallest move** (average distance from the smallest available move 0.13 of a step), but departs from it in about 14% of decisions with three or more options, always in a play that does not skip or strand, so the departures are about future value, not a visible rule.
6. **One extra human-countable term in the written strategy** (unseen cards jumped over) gained 0.8 with four players and nothing elsewhere.

## What it means

- A person cannot be given the network's play as a short rule list from these features. The written strategy's five rules are worth, in order: smallest move (essential), stopping after the minimum (12 to 22 points at tables), look-ahead (3 to 4), backward 10 (1), not jumping over your own cards (0.3). See the guide.
- A robot could use the network itself (about 130,000 numbers, small enough to run on the server or in the browser). That would be a different product decision from the one in the plan (rules a person can read). It is not built; see the final summary.

## Not tried

Features that capture hand structure better (for example the cards that would be played in a row, found by lookahead), search-guided labels, and deeper trees with many more positions. The plan's bar is high and the evidence above suggests the gap is not closed by more of the same.
