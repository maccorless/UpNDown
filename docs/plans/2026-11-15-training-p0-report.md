Created: 15-Nov-2026 13:15 CET

# Training mode, phase P0 report: reference numbers and the stack decision

For Ken's acceptance. Plan: `2026-11-15-training-mode-plan.md`. Everything below was measured on this machine (Apple M5 Max, 18 cores) with validation seeds only; the test set has not been used.

## What P0 built (all pushed)

| Piece | Where | Checked by |
|---|---|---|
| Evaluation protocol: 13 stage tables, fixed train/validation/test seed sets, paired comparison with intervals, three scorings, test-set use log | `packages/engine/src/{tables,evaluation,stats}.ts`, `tools/sim.ts` (`tables`, `eval`) | known-value tests; a win always leaves no cards; the per-step reward sums to the game score |
| Played-card record (Tier B) and hidden-card sampler | `src/belief.ts` | sampler never deals a held or played card; exact reorder in solitaire |
| Reactions: board rules, honest sender, hand-written receiver, simulator support | `src/reactions.ts` | sender is monotone (every single card on both pile types); server's rules and messages; no change for a policy that ignores reactions |
| Exact solver for small solitaire deals | `src/solver.ts` | its plays replayed through the engine reach its claimed score; never beaten by 200 random playouts per deal |
| Python port of the rules, vectorised, and parity suite | `tools/training/{upndown_env,parity}.py`, `run-parity.sh` | 1,040 games, 41,569 actions, zero differences from the TypeScript engine |
| Stack spike | `tools/training/bench*.py`, `packages/engine/tools/actor-spike.ts` | numbers below |

## Reference numbers (the strategy as it stands, 3,000 validation games per table)

Score is Ken's scoring (win 100; loss 91 minus cards in hands minus twice cards in the draw pile). "With reactions" means every player not on turn shows honest reactions and the player on turn applies the hand-written receiver rule.

| Table | Win | Score (95% interval) | Cards left | With reactions: win | Score | Gain |
|---|---|---|---|---|---|---|
| s1-solo-79-h9 | 91.4% | 99.01 (98.89 to 99.13) | 0.21 | n/a | n/a | n/a |
| s1-2p-79-h9 | 93.0% | 99.25 (99.15 to 99.35) | 0.12 | 95.4% | 99.50 | +0.26 |
| s1-4p-79-h9 | 83.2% | 98.15 (97.99 to 98.30) | 0.34 | 84.1% | 98.25 | +0.10 |
| s2-solo-79-h7 | 41.0% | 90.06 (89.68 to 90.43) | 3.58 | n/a | n/a | n/a |
| s2-2p-79-h7 | 59.5% | 95.07 (94.85 to 95.29) | 1.26 | 68.8% | 96.29 | +1.23 |
| s2-4p-79-h7 | 64.5% | 95.89 (95.69 to 96.09) | 0.92 | 71.0% | 96.69 | +0.80 |
| s2-solo-99-h9 | 19.7% | 83.65 (83.18 to 84.12) | 6.99 | n/a | n/a | n/a |
| s2-2p-99-h9 | 48.1% | 93.48 (93.23 to 93.72) | 1.82 | 57.4% | 94.88 | +1.41 |
| s2-4p-99-h9 | 51.9% | 94.24 (94.02 to 94.46) | 1.43 | 60.0% | 95.31 | +1.07 |
| s2-solo-99-h11 | 74.1% | 96.80 (96.59 to 97.00) | 0.84 | n/a | n/a | n/a |
| **s3-solo-99-h7 (real default)** | **0.8%** | **50.92 (50.24 to 51.59)** | 23.46 | n/a | n/a | n/a |
| **s3-2p-99-h7 (real default)** | **6.7%** | **76.03 (75.47 to 76.60)** | 12.00 | 10.6% | 80.64 | +4.61 |
| **s3-4p-99-h7 (real default)** | **21.7%** | **88.59 (88.34 to 88.85)** | 4.36 | 33.2% | 90.95 | +2.36 |

The three real-default rows are what training is judged on. Mean of the three: 71.9 without reactions.

## Exact optimum on small solitaire decks (20 validation deals each, cap 3,000,000 states)

| Table | Solved | Optimum | Strategy on the same deals |
|---|---|---|---|
| s1-solo-79-h9 | 19 of 20 | won 19 of 19 (score 100.0) | won 17 of 19 (98.9) |
| s2-solo-79-h7 | 18 of 20 | won 18 of 18 (score 100.0) | won 9 of 18 (91.1) |

Read with care: the deals the solver gave up on are probably the hardest, so "solved" is biased toward easy deals. The statement that holds is that every deal it did solve, at every size up to top card 79, is winnable with perfect information. Earlier probes: top 59 with hand 5 the strategy falls short of the optimum on 7 of 20 deals, top 69 with hand 5 on 18 of 20. The solver cannot reach the real default (top 99): 14 of 20 deals exceeded the cap. It is a reference for small decks only; it is solitaire only.

Weights of the current strategy are at a flat optimum on every deck size (changing any one of its seven weights gains at most 0.2 points), so a different deck does not ask for different weights. Whether a learned policy plays differently by deck size is what P2 tests.

## The stack decision (plan section 6.1)

The plan prefers TypeScript actors (C) if they reach at least a quarter of the Python port's (B) speed, because one source of rules removes the risk of the two copies drifting. A policy of the same size (two layers of 256) was in the loop for both, on the Apple GPU.

| Option | Steps per second end to end | Notes |
|---|---|---|
| B. Python port, numba, 8,192 games in lockstep | 1.0M (CPU policy) to 2.2M (GPU policy) | 0.6M at 1,024 games |
| C. TypeScript actors, 12 worker processes of 1,024 games, batches over pipes | 0.89M (4 players), 0.90M (solitaire) | 16 workers gave no more; 1 worker 0.32M |
| TypeScript engine alone, random moves, one core | 0.8M | the earlier 50,000 to 100,000 figure was the strategy's cost, not the engine's |

C is at 41% of B's best, above the quarter bar. **Decision: C, TypeScript actors with a Python learner.** The port stays in the repository as a verified cross-check (the parity suite passes) and as the fallback if the data path turns out to be the bottleneck once a real learner is attached. It does not have reactions or the played-card record, and needs them only if it is ever used.

Not measured: a real learner's update step; the actors here used a stand-in observation (hand, pile tops, counts), not the final one.

## Not done in P0

- A perfect-information oracle for multiplayer tables (the plan limits the oracle to solitaire, so this is as planned).
- The observation encoding for training and the learner itself (P2).
- Server and client plumbing for the played-card record, and moving the server's reaction logic onto the shared module (listed in the plan as outside the day count).
- The hand-written receiver and the sender thresholds are untuned; the reaction gains above are a first reading, with an idealised sender that updates after every move.
- Docs, version and changelog are unchanged: nothing here changes the game.

## Tests at the end of P0

Typecheck and lint clean. Client 310, server 366 passed and 34 skipped (they need a database; skipped in this check), engine 122 (including the solver's 5), shared-types 33. Playwright smoke not rerun since the last full check (nothing the browser sees has changed).
