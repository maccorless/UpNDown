Created: 17-Nov-2026 07:40 IST

# Training mode, phase P2 report: learned policies

Plan: `2026-11-15-training-mode-plan.md`, section 5.3. Code: `tools/training/` (trainer, network, features, evaluation) and `packages/engine/tools/actor.ts`. Every number is on **validation** seeds (3,000 paired games per table, same deals as the written strategy); the test set has not been used.

## What was built

A PPO self-play trainer: one network plays every seat, a critic that sees the hidden cards helps train it (and is not part of what is kept), rewards are the per-play form of Ken's score (win 100; loss 91 minus cards in hands minus twice cards in the draw pile). The TypeScript engine holds the only copy of the rules; 12 actor processes play 12,288 games in lockstep and the learner (PyTorch on the Apple GPU) answers over pipes. The policy has no slot order and no pile index (swapping the two ascending piles, or the two descending ones, changes nothing but the order of its scores; tested). Curriculum: easy tables, then medium, then a mix that includes the real defaults.

## Results: real-default tables, mean score (written strategy: solitaire 50.92, 2 players 76.03, 4 players 88.59)

"Robot seats" is the share of other seats that are robots with exact, instant reactions; the rest are human-like (reactions 1 or 3 plays old, or never shown). Tier A sees what the screen shows; Tier B also has the played-card record.

| Run | What it is | Solo | 2 players: robots / mixed / human-like | 4 players: robots / mixed / human-like | Mean of solo, 2p mixed, 4p mixed |
|---|---|---|---|---|---|
| written strategy | the existing hand-set rules | 50.92 | 76.03 | 88.59 | 71.9 |
| a1c | Tier A, no reactions | 57.87 | 83.56 (no reactions) | 93.76 (no reactions) | 78.4 |
| r1 | Tier A, perfect instant reactions | 58.93 | 93.61 | 98.34 | n/a |
| a3 | Tier A, robust reactions, unseen-cards input | 57.20 | 92.96 / 88.19 / 83.25 | 98.09 / 96.25 / 94.07 | 80.5 |
| a6 | a3 with width 128 and decaying learning rate | 58.03 | 93.12 / 88.75 / 83.65 | 98.22 / 96.67 / 94.82 | 81.2 |
| **b3** | **Tier B, robust reactions, width 128** | **58.80** | **95.02 / 91.68 / 87.78** | **99.12 / 98.78 / 98.18** | **83.1** |

Every row beats the written strategy on every table with a paired 95% interval far above zero (for b3: solitaire +7.88 (7.10 to 8.66), 2 players mixed +15.65 (15.01 to 16.29), 4 players mixed +10.19 (9.91 to 10.47)). Win rates for b3: solitaire 2.9% (strategy 0.8%), 2 players 51.5% mixed (strategy 6.7%), 4 players 89.6% mixed (strategy 21.7%).

## What was learned

1. **A learned network clearly beats the hand-written strategy.** About +7 points in solitaire, +8 to +19 with two players and +5 to +10 with four.
2. **Reactions are worth a lot, but only when exact and instant.** A network trained on perfect reactions loses the whole gain when they are one play old and does worse than ignoring them at three (2 players: 93.9 instant, 84.9 at one play old, 74.7 at three, against 83.9 for a network that ignores reactions). Training with a mix of robot and human-like seats, and telling the network which is which, keeps almost all of the all-robot gain and costs nothing when reactions are unreliable. This is the version that can safely sit at a table with people.
3. **The played-card record is worth a lot at tables once it is given in a usable form.** The first Tier B network (a flat list indexed by card value) did no better than Tier A. Adding "how many unseen cards does this move jump over" for each card and pile made Tier B clearly better: with human-like seats, 2 players 87.8 against 83.7 and 4 players 98.2 against 94.8. In solitaire it adds about 0.8.
4. **The network side is near its limit.** Doubling the width and decaying the learning rate added about 0.5 points.
5. **Solitaire on the real defaults is the one table with headroom.** Search on top of the network adds +5.3 (Tier A network, 59.6 to 64.9) and +3.2 (Tier B network, 60.2 to 63.4) on 200 validation games, mostly by winning more of the deals that are winnable (wins 4% to 6%).
6. **Rules a person can follow do not reproduce this.** A two-part student (linear move score, small stop tree) on features a person can compute only matches the written strategy; with the network choosing the move and a small tree choosing when to stop, it almost matches the network. So the network's edge is in which card it plays. See the P4 notes.

## Engineering notes that cost time

- Weight tuning of the written strategy is flat: a different deck size does not want different weights.
- PyTorch's GPU memory cache on this Mac defaults to a ceiling above physical memory; long runs slowed down as the machine swapped. Capped at 35% (`PYTORCH_MPS_HIGH_WATERMARK_RATIO`); the log line now shows GPU memory.
- Scoring only the legal card-and-pile pairs (about 9.5 of 44) made network passes 2.5 times faster with identical outputs. Half precision was not faster here.
- The harness cannot kill processes; the user stops runs with `! kill PID`.

## Not done / caveats

- Test set not used. Final numbers must come from it, once.
- The reaction behaviour of real people is modelled by a lag and silence, not measured. Whether people's actual reactions help a robot is untested.
- Several of the 3,000-game comparisons are between runs on the same deals but not paired across runs; differences below about 0.5 points between runs should not be read as real.
- Solitaire is evaluated with the written strategy's reactions-free baseline only; there are no reactions in solitaire.
