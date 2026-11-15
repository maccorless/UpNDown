Created: 15-Nov-2026 17:07 CET

# Training mode, phase P1 report: the search teacher

Plan: `2026-11-15-training-mode-plan.md`, section 5.2. Code: `packages/engine/src/search.ts`, run with `sim search`. Validation seeds only; the test set is untouched.

## What was built

For each legal play in a solitaire game, the teacher deals the hidden cards at random 20 times, plays the game on with the current strategy to the end in each dealt world, and averages Ken's score. Every candidate sees the same 20 worlds. It leaves the strategy's own play unless a candidate beats it by more than 2 standard errors of the paired difference over those worlds. Solitaire only: with other players the hidden cards are not uniform (plan section 3.2), and the correction for tables is not built.

**The margin is essential.** Taking the best average of 10 worlds without it scored 25% wins on s1-solo-79-h9 where the strategy wins 91%, because with dozens of near-equal candidates the best average mostly picks luck. Margins 1, 2 and 3 gave 77%, 97% and 97% wins.

## Result: search beats the strategy on both tables, with or without the played-card record

150 validation games each, 20 worlds, margin 2, paired against the strategy on the same deals.

| Table | Information | Strategy score | Search score | Paired gain (95% interval) | Search wins / strategy wins |
|---|---|---|---|---|---|
| s2-solo-79-h7 | Tier B, played-card record | 89.33 | 96.19 | **+6.86 (5.05 to 8.69)** | 76.7% / 41.3% |
| s2-solo-79-h7 | Tier A, screen only | 89.33 | 93.05 | **+3.72 (1.65 to 5.71)** | 60.0% / 41.3% |
| s3-solo-99-h7 (real default) | Tier B | 49.35 | 59.94 | **+10.59 (7.37 to 13.83)** | 2.0% / 0.7% |
| s3-solo-99-h7 (real default) | Tier A | 49.35 | 58.27 | **+8.92 (5.55 to 12.58)** | 2.7% / 0.7% |

- **The plan's gate (at least 1 point, interval above zero) passes** on stage 2 and 3 solitaire, in both tiers. Learning is worth trying.
- **The played-card record is worth about 3 points on the medium table and about 1.7 on the real default** (the second difference is not significant with 150 games).
- **On the real default, search still almost never wins** (2% against 0.7%). Its gain is leaving about 5.5 fewer cards (18.8 against 24.3 for Tier B): a better loss, not a win.
- **Cost, as observed (16 worker processes, other jobs sometimes running, so only a guide):** 150 games took 861 s (s3, Tier B), 1,971 s (s3, Tier A), 2,016 s (s2, Tier B) and 161 s (s2, Tier A). The last is unexpectedly fast and was not investigated.

## Not done in P1

- Two-player and four-player tables (the hidden hands are not uniform; needs the reweighting of plan section 3.2). The learner (P2) is trained on all tables and is judged against the strategy there instead.
- The search for the stop-or-continue decision and for reactions (multiplayer only).
- More worlds, a search that builds a tree (ISMCTS), the effect of the margin on larger tables.
- Stage 1 (easy) tables: the strategy already wins 91 to 93% there, so the gain is small (+0.98, interval 0.00 to 2.19, on 64 games of s1-solo-79-h9).
