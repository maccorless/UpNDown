Created: 17-Nov-2026 08:24 IST

# Training mode: final report

Plan: `2026-11-15-training-mode-plan.md`. Phase reports: P0 `2026-11-15-training-p0-report.md`, P1 `...p1-report.md`, P2 `2026-11-17-training-p2-report.md`, P4 `...p4-report.md`. Guide: `docs/strategy/strategy-guide.md`.

## Headline

A learned policy beats the written strategy by a wide margin on every default table, on **test deals used once** (3,000 paired games per row, 95% intervals in brackets). The written strategy scored solitaire 50.05, two players 75.84, four players 88.41 on these deals.

| Table | Network | Seats | Score | Win rate | Gain over the written strategy |
|---|---|---|---|---|---|
| Solitaire | b4, Tier B, solitaire specialist | n/a | 61.01 | 3.4% (written 0.9%) | +10.96 (10.18 to 11.73) |
| Solitaire | a6, Tier A, general network | n/a | 58.22 | 2.1% | +8.16 (7.41 to 8.92) |
| Two players | b3, Tier B | all robots | 94.84 | 63.8% (written 6.6%) | +19.00 (18.39 to 19.62) |
| Two players | b3, Tier B | mixed | 91.94 | 52.0% | +16.11 (15.45 to 16.76) |
| Two players | b3, Tier B | all human-like | 87.91 | 38.0% | +12.08 (11.39 to 12.77) |
| Two players | a6, Tier A | all robots / mixed / human-like | 93.20 / 88.41 / 82.95 | 50.2% / 30.1% / 14.9% | +17.36 / +12.57 / +7.12 |
| Four players | b3, Tier B | all robots | 99.12 | 92.1% (written 20.5%) | +10.71 (10.44 to 10.98) |
| Four players | b3, Tier B | mixed | 98.64 | 88.2% | +10.23 (9.95 to 10.52) |
| Four players | b3, Tier B | all human-like | 98.09 | 84.3% | +9.68 (9.39 to 9.98) |
| Four players | a6, Tier A | all robots / mixed / human-like | 98.12 / 96.68 / 94.81 | 82.8% / 71.0% / 57.1% | +9.72 / +8.27 / +6.40 |

The plan's promotion bar (about 2 points and half a card on the real defaults) is cleared everywhere by a wide margin. Test results agree with validation to within about 0.3 points, so nothing was fitted to the validation deals. The test set was used once, for these networks only (14 evaluation passes, logged in `tools/training/runs/test-set-usage.log`, which is not committed).

"Seats" means how the other players' reactions arrive: robots show exact, up-to-the-play reactions; human-like seats are one or three plays late or silent. Tier A sees what the screen shows; Tier B also uses the list of cards already played.

## What was learned (short)

1. A network beats the hand-set rules by 7 to 19 points at every real-default table.
2. Reactions are worth up to about 17 points, but only when current; stale ones hurt a naive network. A network trained on mixed reliable and unreliable seats (told which is which) keeps most of the gain and loses nothing when reactions are useless.
3. Knowing which cards have been played is worth about 3 to 4 points at tables once it is given to the network as "unseen cards this move jumps over".
4. The written strategy's rules ranked by worth (guide): smallest move, then stopping after the minimum (12 to 22 points at tables), look-ahead, backward 10, not jumping your own cards.
5. The network's edge is in which card it plays, which short human rules do not capture (P4: bar not met).
6. Solitaire on the real defaults stays very hard: even the best network wins 3 to 6% of games. Search on top of the network adds about 3 points more (not built into anything).

## Where each plan phase ended

| Phase | Result |
|---|---|
| P0 evaluation protocol, solver, reactions module, stack | Done and accepted |
| P1 search teacher | Done for solitaire (gate passed in both tiers); not built for tables (needs the belief reweighting of plan 3.2) |
| P2 learned policy | Done; reactions, Tier A and Tier B, robust reactions, width and decay tried |
| P3 expert iteration | Not done: the gap it would close is solitaire-only and about 3 points (search on the best network) |
| P4 distillation to rules | Tried; bar not met; honest report |
| P5 guide and hints | Guide written from the measured written rules; `strategy.ts` and the in-game hint are unchanged |
| Test set | Used once, for the table above |

## Not done, and decisions for Ken

- **A robot or hint that uses the network.** The networks are about 70,000 to 130,000 numbers and could run in the server or the browser. A robot at a table with the Tier A, mixed-seat network would play about 12 to 14 points better than the current robots at two players and 8 points better at four. This is a product decision (a model shipped in the game, a second code path, and a hint that cannot say "why"); it is not built.
- **The hint banner and robots still use the written strategy.** The reaction channel is not used by robots in the game today; the module and a hand-written receiver exist in the engine (`reactions.ts`) and could be turned on separately.
- **How real people react is not measured.** Lag and silence stand in for it.
- **Played-card record in the app.** Tier B needs the record in what the server sends and in the solitaire client (plan section 4.3). Not built.
- **The plan's usability check with people, and the section 10 acceptance of the guide, have not been done.**
- Training code and results live in `tools/training/` (runs and checkpoints stay on this Mac, not committed); training runs only under the network-blocking sandbox.
