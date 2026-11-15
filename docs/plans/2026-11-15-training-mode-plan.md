Created: 15-Nov-2026 11:05 CET

# UpNDown: training mode plan (phase G)

Status: draft for Ken's review. Nothing here is built. Revised on 15-Nov-2026 after an independent review and after Ken's decisions (section 11 records every one; section 15 lists what the review found and what changed). It is the design that section 3.G of `2026-11-14-backlog-enhancements-plan.md` said had to come first. Facts about the game were read from the code on 15-Nov-2026 (v1.44). Facts about research were read from the sources in section 12; where only an abstract or a summary was read, that is said.

## 1. What this is for

Three things, in this order:

1. **Find out how well this game can really be played**, with real mathematics and measurement, not hand-tuned guesses. The hand-set hint strategy wins about 22% of four-player games on the default deck and about 1% of default solitaire games. We do not know whether that is near the ceiling or far below it.
2. **Learn a strong strategy by self-play**, using reinforcement learning and search, entirely on Ken's own machine.
3. **Turn what is learned into two things people can use:** a written strategy guide a human can follow at the table, and a better hint (and robot) that can say why it suggests a play.

Constraints that never move:

- **Local only.** Training never runs on the production server or any hosted machine, uses no player data, and makes no network calls. The only things that leave the Mac are small, reviewed artifacts committed to the repo (a rules file, a guide, summary tables).
- **Hint and robot keep seeing only what a player can see.** Whatever is learned has to be usable from an `Observation` (see section 4.3). A strategy that needs hidden cards is a research result, not a hint.
- **Solitaire still works offline.** The shipped result must run in the browser with no connection, so it has to be small and cheap: rules, not a neural network.

## 2. Where we stand

| Fact | Source |
|---|---|
| Hand-set strategy, four players, default deck: about 22% won, about 4 cards left | `tools/sim.ts`, 3,000 held-out games, 15-Nov-2026 |
| Hand-set strategy, default solitaire: about 1% won, 25 cards left | scratch measurement, 400 games |
| Easy solitaire (59 cards, hand of 8, one card a turn): about 99% won | same |
| A hill-climbing search over 7 strategy weights found nothing better on held-out games | `tools/runs/` and the design doc |
| Two earlier results to keep in mind: a single run's win rate is noisy (3,000 games gives about plus or minus 1.5 points at 22%), and a search that picks the best of several tries on the games it is tuned on overfits | the same runs |
| Dev machine: Apple M5 Max, 18 cores, 64 GB, Node 24, Python 3.14 with no numpy or torch installed | checked 15-Nov-2026 |

So the first honest question is the ceiling. The plan starts by measuring it.

**Where the headroom is.** `npm run sim --workspace @upndown/engine -- calibrate` plays the current strategy on a grid of simpler tables with no cheats (300 games a cell, two cards a turn, 15-Nov-2026). Two things stand out. With a top card of 59 or less the strategy wins nearly every game, so there is nothing to learn from those tables. And a bigger hand helps enormously: on the default 2 to 99 deck, solitaire goes from 1% won with a hand of 7, to 23% with 9, to 74% with 11.

| Table (no cheats) | Won | Average score | Cards left |
|---|---|---|---|
| Solitaire, 2 to 79, hand 7 | 41% | 89.5 | 3.9 |
| Solitaire, 2 to 79, hand 9 | 91% | 99.0 | 0.2 |
| Solitaire, 2 to 99, hand 9 | 24% | 84.0 | 6.9 |
| Solitaire, 2 to 99, hand 11 | 74% | 97.0 | 0.7 |
| Two players, 2 to 79, hand 7 | 54% | 94.3 | 1.5 |
| Two players, 2 to 99, hand 9 | 47% | 93.4 | 1.8 |
| Four players, 2 to 79, hand 7 | 65% | 95.9 | 0.9 |
| Four players, 2 to 99, hand 7 (the default) | 18% | 87.8 | 4.8 |
| Four players, 2 to 99, hand 9 | 58% | 94.9 | 1.3 |

(The score here and everywhere below is the one Ken chose on 15-Nov-2026, section 3.3. Earlier drafts used two other scorings and every number was redone.) The tables worth training on are the ones where the current strategy is neither always beaten nor always winning, about 20% to 90% won. Two more rows from the same grid that the real defaults need: two players on the default deck with a hand of 7 win 5% (score 75.6, 12.2 cards left), and default solitaire wins 1% (score 51.0, 23.4 cards left). Stage 1 rows: two players 2 to 79 hand 9 win 92%, four players 2 to 79 hand 9 win 82%.

**Measured costs and noise** (600 games each, current strategy, no cheats, 15-Nov-2026):

| Table | Steps a game | Steps a second, one core | Games a second, one core | Score, mean and standard deviation of one game |
|---|---|---|---|---|
| Default solitaire | 74 | 69,000 | 920 | 50.7, 19.6 |
| Two players, default | 123 | 99,000 | 800 | 75.8, 15.9 |
| Four players, default | 138 | 97,000 | 700 | 87.6, 7.6 |
| Four players, 2 to 79, hand 9 | 112 | 51,000 | 460 | 98.1, 4.3 |

These include the cost of the current strategy's own look-ahead and the engine's loss check, which is a search over the hand on every state. On 16 cores that is roughly 10,000 games a second for evaluation, so even a 300,000-game paired comparison takes well under a minute with the heuristic (a learned policy is slower). A game's score is noisy, with a standard deviation of about 4 to 20 points (less noisy than the earlier scorings, which swung by 10 to 35), which section 8 uses.

Another fact the numbers show: on default solitaire, 555 of 594 lost games ended with cards still in the draw pile (about 17 of them), so the cost of draw-pile cards is most of what separates a good loss from a bad one there. On default two-player tables the draw pile holds about 4 cards at the end of a loss, and on default four-player tables almost none.

## 3. The game, as mathematics

### 3.1 State, observation, actions

A game for `n` players is a finite, episodic process. The full state is

`s = (t, D, H_1..H_n, i, k, m)`

where `t` is the four pile tops, `D` is the draw pile as an ordered list (hidden), `H_j` are the hands, `i` is whose turn it is, `k` is how many cards were played this turn and `m` is the cheat counters. A pile accepts card `c` if `c > top` (ascending) or `c < top` (descending), or `c = top - 10` / `c = top + 10` (the backward 10). A turn needs at least `r = min(minCardsPerTurn, ...)` plays (1 when the draw pile is empty). The game is won when every hand is empty and lost when the active player has no legal play and has not met the minimum.

Player `i` does not see `s`. It sees the observation `o_i = (H_i, t, |D|, |H_j| for j != i)`, and optionally a public record of which cards have been played (section 4.3). Actions are `play(card, pile)`, `endTurn`, and, if the game allows them, `skip` and `trade(card)`. Illegal actions are removed by masking, not by punishment (section 6.2).

**Reactions are part of the shared state.** A player who is not on turn may set, on each pile, one of none, like, love or really love. Everyone sees everyone's reactions, a player's reactions stay until that player's turn starts and are then cleared, and nobody can set one while on turn (this is how the game works today, in the server's `GameManager`; the engine does not know about them). In the training simulator the reactions sit in the public state next to the pile tops: `r[j][p]` in `{0, 1, 2, 3}` for seat `j` and pile `p`, read by every seat as part of its observation and writable by every seat that is not on turn. That is how robots at a table talk to each other, exactly as people do (decided: section 5.6).

### 3.2 What makes it tractable, and what does not

- **For solitaire the hidden part is exactly exchangeable.** The deck is shuffled uniformly, nobody else acts, and a trade puts a card back at a uniformly random place. So given what the player has seen, the unseen cards are a uniformly random arrangement of the unseen multiset, and "shuffle the unseen cards and deal" is an exact sampler. Search over sampled worlds is exact there.
- **For a table of several players it is not.** What the other seats did is evidence about their hands. A seat that stopped after two plays, when the strategy keeps playing while the move is small, probably holds no card near a pile top, so those cards are more likely in the draw pile than uniform sampling says. The right belief is the uniform prior times the likelihood of every observed choice under the policy the others follow. Uniform sampling would deal small-move cards into other hands and then watch those seats play them at once, so the teacher would over-credit coordination. The plan therefore treats the multi-player teacher as **biased unless corrected**, and corrects it the way the search literature does: reweight sampled worlds by how likely the observed actions were under the base policy (a particle filter over worlds). P1 does solitaire first, where the sampler is exact, then adds the reweighting for tables and measures how much it matters. Until then no guarantee from the literature is claimed for tables.
- **What "unseen" means depends on the tier.** In Tier B the played-card record is public and is part of the observation, so the unseen set is well defined. In Tier A it is not observed, so the cards past an ascending pile top are more likely still unplayed than the ones before it, and the sampler conditions on the pile tops. A teacher is allowed to use only public information plus the observing player's own hand, and to reach hidden cards only through belief sampling. A Tier A student distilled from a Tier B teacher is an explicit privileged-teacher setup, labeled as such, and judged by simulating the student, not the teacher.
- **Cooperative with a shared reward.** Every seat wants the same thing, so "self-play" here is not training against an opponent. One policy `pi_theta` controls every seat. The standard name is a decentralized partially observable MDP (Dec-POMDP); the practical recipe is centralized training with decentralized execution: a critic may read the full hidden state while training, and the policy that is kept reads only its own observation. A critic that sees more only provides a baseline and cannot leak into the policy; the teacher labels used to extract rules are the thing that must not.
- **Reactions are the one real channel, and its meaning is fixed.** In Hanabi, self-play agents invent private signalling conventions that fail with strangers (Hu et al., "Other-Play"). The reaction channel invites exactly that, so its meaning is **grounded**: it is what How to Play already says it is, "I have a great card for this pile", with the level rising with how good the sender's best card for that pile is (section 5.6). The sender's thresholds can be tuned, the direction of the meaning cannot. A second, quieter place a convention could hide is an arbitrary choice between interchangeable things: the two ascending piles are interchangeable, and so are the two descending ones. The plan removes that by construction (section 5.3: piles are presented in a canonical order and the network is symmetric under swapping a pair) and tests it: a trained policy is played against an independently trained copy, and its score must not drop.

### 3.3 The objective

For the table the strategy is judged on, maximize the expected team score

`J(pi) = E[ R ]`, where `R = 100` if the game is won, and otherwise `R = 91 - H - 2 * D`, with `H` the cards left in the players' hands and `D` the cards left in the draw pile when the game ends.

This is the scoring Ken chose on 15-Nov-2026: a win is 100; a loss with one card left in the hands is 90 and each further card in the hands costs 1; every card left in the draw pile costs 2, because running out of moves while the draw pile is still full is worse than getting through the deck and stalling at the end. His examples, all checked by tests: 3 cards left in the hands scores 88; 10 cards left scores 81; two players with hands of 7 and 30 cards left (14 in the hands, 16 in the draw pile) score 100 - 10 - 13 - 32 = 45. There is no cliff and no floor: each card costs the same wherever it is, scores can go below zero in a very bad game, and the score is never clipped.

**A game is not just won or lost.** Finishing with fewer cards left is always worth more than finishing with more, hand card or draw pile card, so a loss at 2 cards left scores far above a loss at 25. When almost every game is lost (default solitaire wins about 1%), the win rate says nothing, and the average score and the average cards left are what learning and the gates are judged on. Reports always show win rate, score and cards left together.

**What this scoring does and does not reward.** A win is worth 10 points more than being one card short, so a one-point rise in win rate moves the average score by only about 0.1 points, and the cards left in lost games dominate the number. That is by design (it measures how close a strategy gets, and is much less noisy than a win-heavy score), and it means a strategy could score well by always stopping one or two cards short without often winning. So win rate is always shown next to the score, any disagreement is reported, and a candidate strategy is never promoted on score alone while its win rate falls. A check on three different strategies on five tables (the current one, a stripped-down one, and a deliberately reckless one) ranks them the same under this scoring and under the earlier ones, so the choice of scoring does not change which strategies look best. Two other scorings are also reported as robustness views (an earlier one with a win at 100 and a loss at 30 times the share played, halved when the draw pile was not emptied, and pure cards left with no win bonus); they are functions of the same few numbers, so they are checks, not independent evidence.

**Per-play form, for learning.** Let `Phi(s) = -(H + 2D)` for the cards left at a moment in the game. A card played from a hand raises `Phi` by 1 and a card drawn from the pile into a hand raises it by 1, so the dense reward is the change in `Phi` after each step, and at the end the game adds `+100` for a win or `+91` for a loss. Summed over a game this is `R` plus the constant `-Phi(s_0)` for the table, which is the same for every game on that table and changes nothing about the best policy. This is potential-based, so it cannot distort what is optimal.

Two checks belong to P0, not to trust. First, a win must always mean no cards left, because `Phi = 0` is assumed at a win: the engine calls a game won when every hand is empty, so a property test over many seeds and all training tables must confirm a win leaves nothing in the draw pile. Second, undo, skip, trade and cheats are off in the training tables (so no play is ever taken back and no action changes the cards left in an odd way).

Any further shaping must also be potential-based (Ng, Harada and Russell): adding `gamma * Phi'(s') - Phi'(s)` to the reward leaves the optimal policy unchanged, but only for a fixed `Phi'` with `Phi' = 0` at the end of a game. A potential that moves while training (for example the current planner's value estimate) does not have that guarantee, so any extra potential is frozen before a stage starts and is taken from a finished earlier stage, never learned online. A bonus that is not of this form can change the best policy and is not used.

## 4. Design

### 4.1 One principle: measure before learning

Every claim in this plan is judged by a fixed evaluation protocol (section 8), and the first deliverable is that protocol plus two reference numbers: the strategy we have and an upper bound. Learning methods are only trusted relative to those.

### 4.2 Phases

| Phase | What | Output | Gate to continue |
|---|---|---|---|
| P0 | Evaluation protocol (three scorings), exact solver for small solitaire decks, belief sampler, the public record of played cards, **reactions in the simulator as a pure shared module with the grounded sender rule and a hand-written receiver rule**, a fast simulator, the stage tables of section 4.4 | reference numbers: heuristic, perfect-information oracle, exact optimum on small decks | Reference numbers exist and the simulator matches the TypeScript engine on golden traces |
| P1 | Search teacher: single-agent search over sampled worlds, on top of the current heuristic as the base policy | How much search adds over the heuristic, per table | Uplift of at least 1 score point (about one card fewer left) on stage 2 and stage 3 tables, paired and with an interval that excludes zero (else the ceiling is near and learning is a low-value bet) |
| P2 | Learned policy by self-play: PPO with action masking, a centralized critic, per-play reward, **a learned receiver of reactions and tuned sender thresholds (section 5.6)** | A network that plays with `o_i` only; its curve against P1 and the heuristic | Matches or beats P1 on held-out games, or beats the heuristic with a clear explanation of what it learned |
| P3 | Expert iteration: use the network to guide the search and the search to improve the network, repeated | A stronger teacher, and a policy distilled from it | Only if P2 stops short of P1; skipped otherwise |
| P4 | Distillation to human-readable rules | A rule list with measured fidelity and retained strength | Non-inferior to the teacher within 5% of its measured gain over the heuristic (section 8) |
| P5 | Strategy guide and hint integration | `docs/strategy/strategy-guide.md`, `strategy.ts` reading a rules file, hint text that says why | Section 10 acceptance |

P0 and P1 need no neural network at all and may already beat the heuristic by a lot. That is why they come first, and why P2 is conditional. Search cost is real: about a thousand rollouts of about fifty steps for each decision is minutes a game, so P1 is budgeted and reported per decision, and evaluated on fewer games than the heuristic.

### 4.3 What the policy may know (two tiers)

Today's `Observation` (in `strategy.ts`) is: the player's hand, the four pile tops, the size of the draw pile, the sizes of the other hands, how many cards were played this turn, how many must be played, whether it is the player's turn, and whether skip and trade are allowed. It has no seat position, and the other hands' sizes are listed in table order, not relative to the player. For training the cheat flags are constant (no cheats), and whether hands refill after each play is an explicit input, because it differs by default (solitaire refills, multiplayer does not) and changes both the decisions and the belief.

- **Tier A, what you see:** that observation, plus every player's reactions on each pile (public, section 5.6), with the other hands' sizes in order from the player's left and no seat feature (a hint cannot supply one and it invites conventions).
- **Tier B, plus the played-card record:** which values have been played so far. This is public information (the piles are stacks anyone can look through), and it is what lets a careful human count cards. It is added to `Observation` as an optional public field and filled by the server and by the solitaire client, so a client that reconnects mid-game still has it. Whether the app lets a player look through a pile's history is not established yet; if it does not, the advanced section tells a player to keep count, and the client keeps the record itself.

Both tiers are trained and reported. Tier A becomes the main human guide. Tier B becomes an "advanced: counting cards" section and a stronger hint, if it is worth it.

### 4.4 Which tables: train simple, test on the real thing

Training runs use **simpler tables**: **no cheats at all** (the cheat actions are not in the action space and the counters are not in the state), **undo off**, a **lower card range** and **more cards in hand**. That keeps wins common enough to give a learning signal, and it is the same game with easier settings. From the calibration in section 2 (current strategy, won / average cards left):

| Stage | Tables (all no cheats) | Current strategy |
|---|---|---|
| 1, easy | solitaire 2 to 79 hand 9; two players 2 to 79 hand 9; four players 2 to 79 hand 9 | 91% / 0.3; 92% / 0.1; 82% / 0.4 |
| 2, medium | solitaire 2 to 79 hand 7; two players 2 to 79 hand 7; four players 2 to 79 hand 7; solitaire 2 to 99 hand 9; two players 2 to 99 hand 9; four players 2 to 99 hand 9; solitaire 2 to 99 hand 11 | 43%, 54%, 65%; 23%, 45%, 60%; 74% |
| 3, **the real defaults** | solitaire 2 to 99 hand 7; two players 2 to 99 hand 7; four players 2 to 99 hand 7 (the shipped defaults) | 1% / 23 cards left; 6% / 12.4; 21% / 4.6 |

This is a curriculum: the policy is trained on stage 1, then continues on stage 2, then stage 3, mixing earlier stages back in so it does not forget. One network handles all of them because the settings (players, deck size, hand size, cards per turn, refill) are inputs, and every distance in the features is also given as a fraction of the deck (`gap / deck size`), so what is learned on a smaller deck can carry to a bigger one. Whether it does is exactly what stage 3 measures, and is not assumed. **Evaluation always covers all three stages, and the real defaults in stage 3 are what the plan is judged on.** Stage 3 is the hardest (default solitaire wins about 1%), so for those tables the reward and cards left are the measures that move.

Cheats are left out of training on purpose: they are a small, separate set of decisions, and mixing them in would make a hard problem harder. Where the final hint uses skip or trade, that stays a simple rule layered on top, and measuring what a learned cheat policy would add is a possible later step, not part of this plan.

## 5. The methods, and why

### 5.1 Exact solver and a bound (P0)

**Solitaire only.** On a small deck (for example 12 to 18 cards, hand 3 to 4) one-player solitaire can be solved exactly by expectimax with memoization over `(t, own hand, unseen set)`, because the unseen order really is uniform (section 3.2). That gives the true optimum `V*` for those tables, and it is how learning methods are checked: a method that cannot reach `V*` on a table it can fully solve is not to be trusted on a big one. For several players the optimum depends on what the other seats do and on what their choices reveal, so `V*` is not defined the same way and no exact solver is claimed for tables.

**A best-found bound, not an upper bound.** Planning with the draw order known (perfect information) gives a good play for the real deck, but on 98 cards it is itself a hard search, so what it returns is the best found, a lower bound on the true oracle value. It is reported as "best found with perfect information" and is not used to split the loss into "hidden information" versus "bad decisions".

### 5.2 Search teacher (P1)

Search over sampled worlds, in two named variants from the literature:

- **Determinization:** sample a world consistent with `o_i` (shuffle `U`), solve or roll out that world as if fully known, average over many worlds, pick the action with the best average. Cheap, and known to suffer from "strategy fusion" (it acts as if it will know hidden cards later).
- **Information-set search (ISMCTS):** build the search tree over what the player can observe, sampling a fresh world at each iteration, with a UCB-style selection rule (in the paper the exploration term counts how often an action was available, not the parent's visit count; the exact form is taken from the paper when this is built). It addresses strategy fusion, though the paper does not claim to remove it completely, and is the sounder choice when the first variant shows it matters.

The base policy for rollouts is today's heuristic. A result from Hanabi (Lerer et al., SPARTA) is the model here: search on top of a fixed "blueprint" policy, with the other seats following the blueprint, is reported to be no worse than the blueprint up to a bounded error and reached a state-of-the-art score. In our game all seats are one policy, so single-agent search against copies of the blueprint is the natural form. That guarantee assumes beliefs are updated correctly, which is why section 3.2 requires the reweighting for tables.

### 5.3 Learned policy (P2)

- **Algorithm:** PPO (clipped surrogate `L = E[ min(rho_t * A_t, clip(rho_t, 1-e, 1+e) * A_t) ]`, `rho_t = pi_new / pi_old`, `e = 0.2`) with generalized advantage estimation `A_t = sum (gamma*lambda)^l delta_{t+l}`. Chosen because it is the standard stable on-policy method and has a published cooperative multi-agent form (MAPPO) that was competitive on Hanabi.
- **Action masking:** illegal actions get logit `-infinity` before the softmax. The masked gradient is a valid policy gradient (Huang and Ontañón), and masking scales where punishing illegal actions fails.
- **Centralized critic:** `V_phi(s)` reads the full state (all hands and the draw pile order) during training only. The policy reads `o_i`. This cuts variance without leaking hidden cards into what is shipped.
- **Network:** small (a few hundred thousand parameters), a per-card encoder shared across hand slots (so the policy does not depend on slot order), pooling, then a head over `(card, pile)` pairs plus `endTurn`. Symmetry is built in, not learned: the hand is a set (no slot order), and the two ascending piles and the two descending piles are presented in a canonical order (by top card) with the network symmetric under swapping the pair. Nothing about a pile's index, and no seat position, reaches the policy.
- **Seats:** one parameter set for every seat. There is no seat feature.

### 5.4 Expert iteration (P3, only if needed)

Planning improves a policy, and a network generalizes the plans: the search produces better moves than the network alone, the network is trained to imitate them, and the improved network guides the next search (Anthony, Tian and Barber; the same loop underlies AlphaZero, which selects moves with a rule that mixes the value estimate and the network's prior probability of the move; the exact form, including how its exploration constant changes with visits, is taken from the paper when this is built). It is more work than P1 plus P2 and is only worth it if the network falls short of the search.

### 5.5 Distillation to rules (P4)

A network is not a guide a person can use. The method is policy extraction (Bastani, Pu and Solar-Lezama, VIPER): train a small decision tree to imitate the teacher, collecting data on the states the tree itself visits (DAgger-style), and weight each state by how much the teacher's value differs between its best and worst action, so the tree spends its capacity where the choice matters. In their experiments trees matched the networks they were distilled from while being far smaller. Ours has an extra requirement they did not: every feature has to be something a person can compute at the table (section 7).

### 5.6 Reactions (like, love, really love)

**What the game does today.** A player who is not on turn can set none, like, love or really love on each of the four piles. All players see them; a player's reactions clear when that player's turn starts. How to Play describes the meaning as a signal that the player has a great card for that pile. They live only in the server (`game-manager.ts`), not in the engine, and robots never set them.

**What the plan does (decided by Ken, 15-Nov-2026).**

- **One shared, public place.** In the simulator the reactions are part of the shared state (section 3.1), read by every robot and writable by every robot that is not on turn, under the same rules as the game. They come from one small pure module (set, clear at the start of a turn, who may set) that the server and the simulator both use, so robots at a live table follow the same rules as in training. Today's server logic moves into that module when robots start to use reactions in the real game.
- **Grounded meaning.** A sender's level on a pile reports how good its best card for that pile is: it is a rising function of the smallest move (as a fraction of the deck) among its cards that can legally go on the pile. None, like and love are thresholds on that move; really love is a backward 10 or a very small move. A sender may also stay silent. What is learned is only the thresholds (a few numbers per table setting, shared by all senders, tuned by self-play inside this monotone family), so a person can compute and read exactly the same signal.
- **The receiver learns to use it.** The active player's network sees all the reactions as input and learns how to act on them. A hand-written receiver rule is the comparison and the first candidate for the guide: for example, do not take a pile a teammate loves unless the move is tiny or a backward 10, and prefer the pile nobody cares about.
- **What is measured.** (1) no reactions; (2) reactions with the hand-written receiver rule; (3) grounded sender with a learned receiver; (4) fully learned signalling where the meaning could be anything, as research only to show the ceiling, never shipped. The value of the channel is the paired difference between (3) and (1) in score, per table, with the usual intervals; it may turn out small, and that is reported as it is.
- **Two checks that keep it honest.** The sender is truthful and monotone (a test: the level never falls as the sender's best card gets better). And the learned receiver is played against a hand-written human-style sender (the How to Play meaning): it must not do worse than against the learned senders, because it has to understand people.
- **Reactions help hints too.** They are public, so a hint can read them ("Ann loves the second pile, so a card near it may be waiting"), and a human's reactions are read by robots exactly as a robot's are.

## 6. How training is built

### 6.1 Stack (a decision for Ken, section 11)

| Option | Pros | Cons |
|---|---|---|
| **A. All TypeScript** | One source of rules; no new language | No automatic differentiation; hand-written training code; hard to trust |
| **B. Python plus PyTorch, with a vectorized Python simulator checked against the TypeScript engine** | Standard tools, fast batches, easy to reproduce a paper's method | Two copies of the rules, plus the base strategy and the feature extractor, all needing parity |
| **C. TypeScript simulator as the one source of rules, many Node worker processes making self-play data, a Python PyTorch learner reading it** | One source of rules (and of the base strategy and features) | The actors need the network to choose moves (a small MLP in TypeScript, or batched calls to the learner), and the data path between them has to be built |

The old recommendation was B. The measurements in section 2 change that: the TypeScript engine already does about 50,000 to 100,000 steps a second per core including the heuristic, so about a million a second on 16 cores, which is the same order as the speed a Python port was meant to buy. So **P0 starts with a one-day spike** that builds the smallest working version of both B and C, measures steps a second end to end with a neural policy in the loop, and chooses. The preference going in is C if it reaches at least a quarter of B's speed, because one source of rules removes the largest risk (drift). The parity suite below is needed only if B wins.

**Result of the spike (15-Nov-2026): C.** TypeScript actors with 12 worker processes reached 0.89M steps a second end to end with a network in the loop, 41% of the Python port's best 2.2M and above the quarter bar. The port was built and passes the parity suite (1,040 games, 41,569 actions, no differences); it stays as a cross-check and fallback. Details in `2026-11-15-training-p0-report.md`.

**Parity suite (if B).** Golden traces generated by the TypeScript engine are replayed in the Python simulator, which must give identical states at every step. Random games rarely reach endgames, losses, or the turn minimum edge cases, so traces also come from targeted generators for each rule (backward 10, minimum met or not, refill on and off, win, loss) and run with an injected random source, since the engine's trades and shuffles use their own. The suite covers the **base strategy and the feature extractor as well as the engine**, because those are what the learner starts from and what the rules are measured against. It runs in CI on every rules change.

Anything the work needs can be installed, and recent versions are fine: the plan assumes the current stable Python, PyTorch (with the Apple GPU backend), numpy, numba and scikit-learn, whatever is current on the day. They go into an isolated environment managed by `uv` under `tools/training/`, with a lock file that pins exact versions and hashes so a run can be repeated, never into the system Python. The first task of P0 is to check that the chosen versions install and run on this Mac (PyTorch support for the newest Python is the usual snag); if the newest Python is not supported yet, the plan uses the newest one that is, and moves up later.

### 6.2 Throughput

Measured, not assumed: about a million engine-plus-heuristic steps a second on 16 cores (section 2). PPO on a game this size needs on the order of 10^7 to 10^8 steps, so engine time is a few minutes to a couple of hours. The real cost is the policy: a network forward pass for every decision (on the Apple GPU or the CPU) and the learner's updates, so a full run is probably hours to a day, not minutes. The loss check in the engine (a search over the hand on every state) is part of every step and is already in the numbers above. The spike in 6.1 replaces this paragraph with measurements.

### 6.3 Local only, and how that is enforced

- **The operating system enforces it.** Training and evaluation run under macOS `sandbox-exec` with a profile that denies all network access, so a library that tries to phone home (a model downloader, telemetry, a dependency that reaches the network, Node's built-in `fetch`, anything started through a subprocess) simply fails. This is the real guard.
- **Installing is a separate, deliberate step.** It is the one place the network is used. It runs from the lock file with hashes (`uv sync` with hash checking), so every package is exactly the one that was reviewed, and installing is never done by a training run. Because any library at any version is allowed, the lock file is committed and changes to it are reviewed like code.
- **A static check is a secondary guard.** A script fails if anything under `tools/` imports a networking module or calls `fetch`, which catches mistakes early and is not relied on.
- **No player data is read.** Games are generated from seeds. Nothing is uploaded; the commit boundary is the only exit, and only reviewed artifacts cross it.
- Large artifacts (checkpoints, logs) stay in an ignored folder outside git; only config, summary tables, the final rules, the lock file and the guide are committed.

### 6.4 Starting a run and watching the outcome

A run is started only from the command line (`train`, `eval`, `report`, `export`), never from the website or the server. Every run gets a folder with `config.json` (all hyperparameters, seeds, the git commit), `metrics.ndjson` (one line per iteration: steps, win rate, mean reward, cards left, entropy, loss terms), `checkpoints/` and `eval.json`. `report` writes one self-contained HTML page (inline SVG charts, no external scripts or fonts) that shows: learning curves, win rate and cards left by table with confidence intervals, a comparison with the heuristic and the search teacher, and a replay of any game from its seed, move by move, using the same rendering as the app. While a run is going the page refreshes from the latest metrics file, so it can be watched from a browser opened on a local file. This is the mechanism for "start it and watch the outcomes".

## 7. The strategy document

The goal is not a policy dump. It is a short guide a person can apply, and that the hint can quote.

1. **Feature set a person can compute.** For a candidate play: the size of the move (`gap`), whether it is a backward 10, how many other cards in hand it jumps over on that pile, how much room the pile has left, how many of my cards sit within 10 of the pile, whether the turn minimum is met, how full the draw pile still is, whether this card has no home. Each is a number or yes/no read straight off the table.
2. **What a rule is.** The current strategy ranks every legal play by a weighted score with a short look-ahead, and a plain first-match list cannot say how to order two candidates when "smallest move" and "fewest skipped" disagree. So a rule is defined on a **candidate play** (a card on a pile), not on a state: the guide is a short, ordered list of tests that a candidate is put through, with a stated tie-break (the smallest move wins ties). It covers the **end-of-turn decision** too ("stop when the minimum is met unless the next move is this small"), and it is the greedy form of the policy, not the stochastic one. Whether a list of that shape can keep the strength is the thing P4 measures and may find it cannot.
3. **Extraction.** VIPER-style tree on those features, then converted to the candidate-test form above. Depth and rule count are capped (target at most 7 rules, each using at most 3 of the features) so the result fits on a card; if that cannot keep the strength, the cap is raised and the guide says it is longer.
4. **Measured fidelity, in the TypeScript simulator.** The rules that ship run in TypeScript, so retention is measured there, not in the training simulator. Reported for every extraction: how often the rules pick the teacher's move (weighted by how much the choice matters) and, the number that counts, how much of the teacher's gain over the heuristic the rules keep when they play whole games, stated as the non-inferiority claim of section 8 (within 5% of the gain).
5. **Reactions are part of the guide.** A short section says how to send them (the grounded meaning, with the thresholds in plain numbers) and how to read and act on a teammate's, from rules extracted the same way, with the measured value of using them.
6. **The document is generated, then edited by a person.** A script writes a skeleton from the rule list with real numbers (each rule's win-rate effect from ablation: play with that rule removed), worked examples taken from replayed games (the actual position, the rule that fired, what the teacher would do), and the measured strength of following the guide exactly. Ken edits the wording. It lands as `docs/strategy/strategy-guide.md` and replaces the short "Quick Strategy" on How to Play.
7. **Human usability check.** A few people play fixed seeds with and without the guide. With so few people the results cannot show a difference in strength (the noise is far larger than any effect), so this is a usability check, reported and not a pass-or-fail gate: can people follow the rules, how long does a decision take, where do they go wrong. If a powered study is wanted later it needs a pre-set number of players and effect size.

## 8. Evaluation protocol (fixed in P0, used by everything)

- **Three seed sets, never mixed.** *Training* seeds are used by learning. *Validation* seeds are used to choose between methods and checkpoints. A *test* set is used once, at the end, for the numbers that are reported and for acceptance; looking at it for any other purpose retires it and a new one is drawn. Reusing one fixed evaluation set for every decision is the same overfitting the earlier search suffered, and this prevents it.
- **One primary metric, fixed before the results exist.** The mean reward (section 3.3) on the three stage 3 tables, paired against the current strategy on the same shuffles. Everything else (win rate, cards left, the other two scorings, stages 1 and 2) is secondary and reported with a multiple-comparison correction (Holm) where it is used to claim anything.
- **Paired comparisons, with sizes chosen from the measured noise.** One game's score has a standard deviation of about 4 to 20 points (section 2). For a paired difference with standard deviation `sd`, detecting a difference `d` at 95% confidence and 80% power needs about `n = 7.85 * sd^2 / d^2` games. With `sd` about 15 and `d` = 2 points that is about 440 games; to resolve 0.1 points it is about 180,000, and about 50,000 on the less noisy tables. The heuristic plays about 10,000 games a second on 16 cores, so validation sets of 20,000 games and a final test set of 200,000 paired games per table are affordable (a learned policy is slower, and its test set is sized to its speed). Win/loss differences use McNemar's test and reward differences a paired bootstrap.
- **Retention is a non-inferiority claim, not a ratio.** "The rules keep at least 95% of the gain" is restated as: the lower end of the 95% interval for (rules minus teacher) is no worse than a stated margin, set to 5% of the measured gain over the heuristic. With a 2 point gain that margin is 0.1 points, which needs the large test set above (about 180,000 games with `sd` 15).
- **Several training seeds.** A learning method is reported as the mean and spread over at least 5 independent training runs.
- **Honest negatives.** A method that does not beat the baseline is recorded, as the hill-climbing search was.

## 9. Integration with the hint and robots

- `strategy.ts` gains a rule policy next to the weighted one. It loads a versioned `rules.json` (the rule list, thresholds, text for each rule) and returns, for each suggestion, the id of the rule that fired. The hint banner can then say why ("Smallest move available") and the guide's rule numbers match.
- The information boundary stays: the rule policy takes an `Observation` and nothing else. The existing test that blanks every hidden card and requires identical advice is extended to the new policy, and to the played-card record, which is public.
- The weighted heuristic stays as the fallback and as the baseline the rules are measured against. Robots use the same policy as hints, so a better guide is a better robot.
- **Reactions:** robots at a live table set reactions with the grounded sender rule and act on everyone's reactions with the extracted receiver rules, through the shared reactions module; the hint banner can mention what teammates have signalled and why a play avoids or favours a pile they care about.
- Cost: rule evaluation is a few comparisons; no concern for solitaire in the browser.

## 10. Acceptance

A strategy is promoted into hints and the guide only if all of these hold, measured on the test set of section 8:

1. **Primary:** on the three stage 3 real-default tables, the mean score (section 3.3) beats the current strategy by at least 2 points and leaves at least half a card fewer on average, with a paired interval that excludes zero. Win rate is reported but not judged on the hardest tables, where wins are too rare.
2. **No regressions:** on the stage 1 and 2 tables the strategy is non-inferior to the current one within a 1 point margin (Holm-corrected, so eight comparisons do not make a fair strategy fail by chance).
3. **As rules:** non-inferior to the teacher within 5% of the measured gain (section 8), and the strength stated in the guide is reproduced by a fresh simulation from the guide's own rules.
4. **Information boundary:** the hidden-information tests pass for the rule policy and for the teacher used to produce its labels (it may use public information and its own hand, and reach hidden cards only through belief sampling), for both tiers, and a cross-play test with an independently trained copy shows no drop.
5. **Reproducible:** everything above can be redone from the committed config, lock file, seeds and commit hash.
6. **Reactions:** the value of the channel (grounded sender with a learned receiver against no reactions) is reported per table with intervals, the sender passes the truthful-and-monotone test, and the receiver does not do worse against the hand-written human-style sender. If the channel adds nothing measurable, that is the result and the guide says so.
7. **Usability check** reported (section 7.7), not a gate.

If P1 and P2 show the ceiling is close to where the heuristic already is, the right outcome is a short, honest report saying so, plus the strategy guide written from the heuristic's own rules with measured numbers. That is still a deliverable.

## 11. Decisions (all made by Ken on 15-Nov-2026)

Each line is the outcome.

1. **Stack.** A one-day spike in P0 decides between a Python port with a parity suite (B) and TypeScript actors feeding a Python learner (C), with C preferred if it reaches a quarter of B's speed (section 6.1).
2. **What the policy may know.** Both Tier A (what you see, including reactions) and Tier B (plus the played-card record), reported separately. Tier B needs a public `playedValues` addition to `Observation`, to what the server sends, and to the solitaire client (outside the day count, section 12).
3. **Which tables.** Staged: simple no-cheat tables first (smaller card range, bigger hands, undo off), then medium, ending on the real defaults, always evaluated on the real defaults (section 4.4).
4. **The scoring.** Win 100. A loss with one card left in the hands is 90, each further card in the hands costs 1, and every card left in the draw pile costs 2 (so a loss scores 91 - H - 2D; section 3.3). Chosen by Ken after he judged the first version (win 100, loss 30 times the share played, halved if the draw pile was not emptied) too harsh. Judged on score and cards left as well as win rate, with two other scorings shown as a check.
5. **The bar for promotion.** On the real-default tables, at least 2 score points (on this scale about two cards fewer left, which also covers the half card Ken asked for) better than the current strategy (paired, interval excludes zero), not worse than 1 point on easier tables, and written rules within 5% of the strong player's gain, on a once-only test set (sections 8 and 10).
6. **Stop rule.** Build the foundations and the search teacher first (about 10 working days), report, and stop if search adds under 1 score point on the medium and real tables.
7. **Artifacts in git.** Summaries, the final rules file, the guide and the lock file, and also the best checkpoint (a small network, kept under about 5 MB). Logs and other checkpoints stay on the Mac outside git.
8. **Human usability check.** Yes, as a usability check and not a pass-or-fail gate (section 7.7).
9. **Python and libraries.** Install whatever is needed, at current versions, in an isolated `uv` environment with a pinned lock file under `tools/training/`.
10. **Network isolation.** Yes: training and evaluation run under an operating-system sandbox that denies the network, and packages are installed as a separate step from a hash-pinned lock file (section 6.3).
11. **Validation and test sets.** Yes: a once-only test set and one pre-registered primary metric, mean score on the three real-default tables (section 8).
12. **Reactions.** The meaning is grounded (section 5.6): robots communicate through one shared public place, the sender's level rises with how good its best card for the pile is, the receiver learns to act on it, and a freely invented code is measured only as research and never shipped.

## 12. Sizes

About 40 working days if every phase runs, or about 20 if it stops after P1 with a report. The phases are P0 7 (including the one-day stack spike, the installation check, and the reactions module and rules), P1 5, P2 11 (including the receiver and the sender thresholds), P3 5 (only if needed), P4 7, P5 4. Not in that number and each a real piece of work: the Tier B plumbing (public played-card record in `Observation`, the server's messages, the solitaire client, the reconnect case), moving the server's reaction logic into the shared module and letting robots use it at live tables, the documentation the project requires with each change, the hint banner showing a rule's reason, recruiting people for the usability check, and any change to How to Play. Compute is not the constraint on this machine; clear results and careful engineering are.

## 13. Risks

- **The ceiling is close.** The likely finding for the hardest tables (default solitaire at about 1% with a hand of 7) may be that no policy does much better, though the calibration shows hand size alone moves it from 1% to 74%. Mitigation: the exact solver and the oracle bound say so early, and the gate in P1 stops spending.
- **Simulator drift.** If a Python port is used, two copies of the rules (and of the base strategy and features) can disagree. Mitigation: prefer one source of rules (option C), otherwise the parity suite in CI on every rules change.
- **The reaction channel adds little, or invites an unreadable code.** It may add almost nothing once the receiver is learned, and a freely learned code would be useless to people. Mitigation: the meaning is grounded and checked (section 5.6), the channel's value is measured against no reactions, and the fully free version is research only.
- **Biased belief for tables.** Uniform sampling of other seats' hands is wrong once their choices are observed. Mitigation: reweighting by action likelihood, measured against the uniform version, and no guarantee claimed until it is done.
- **Noise mistaken for gain.** Mitigation: separate validation and test sets, one primary metric, a multiple-comparison correction, and sample sizes chosen from the measured noise.
- **A supply-chain or network surprise from "any library, any version".** Mitigation: an operating-system network sandbox for runs, and hash-pinned installs.
- **Noisy results.** Wins are rare on the hard tables. Mitigation: paired seeds, intervals, repeated runs, fixed sample sizes chosen in advance.
- **Overfitting to the simulator or to one table.** Mitigation: held-out seeds, several tables, and ablations.
- **Rules lose too much.** A rule list may keep far less than 95% of a network's play. Mitigation: report retention honestly; consider a larger feature set or a small lookup of exceptions; if it still fails, the hint can keep using search-free rules and the guide says what the strong play adds that a person cannot easily do.
- **A library does not support the newest Python yet.** Mitigation: check in P0, use the newest Python that every needed library supports, in an isolated environment with a pinned lock file.
- **Skill learned on easy tables does not carry to the real game.** Mitigation: the curriculum ends on the real tables, features are scaled by deck size, and evaluation always includes the real game.
- **Human value is the real test.** A strategy that wins in simulation but that people cannot follow is of little use. Mitigation: the human check is part of acceptance.

## 14. References

Read as abstracts or summaries unless noted; none was read in full for this plan.

- Bard et al., "The Hanabi Challenge: A New Frontier for AI Research" (Artificial Intelligence, 2020): https://arxiv.org/abs/1902.00506 . Secondary coverage reports deep RL trailed hand-coded bots in self-play and did not cooperate with unfamiliar partners (not verified in the paper).
- Lerer, Hu, Foerster and Brown, "Improving Policies via Search in Cooperative Partially Observable Games" (AAAI 2020, SPARTA): https://ojs.aaai.org/index.php/AAAI/article/view/6208 . Search on a fixed blueprint is reported to be no worse than the blueprint up to a bounded error, and gave a state-of-the-art score on Hanabi.
- Hu, Lerer, Peysakhovich and Foerster, "Other-Play for Zero-Shot Coordination" (ICML 2020): https://arxiv.org/abs/2003.02979 . Self-play invents conventions that fail with new partners.
- Yu et al., "The Surprising Effectiveness of PPO in Cooperative Multi-Agent Games" (MAPPO): https://arxiv.org/abs/2103.01955 . A centralized value function used only in training, with local policies.
- Schulman et al., "Proximal Policy Optimization Algorithms" (2017): https://arxiv.org/abs/1707.06347 . Clipped objective.
- Huang and Ontañón, "A Closer Look at Invalid Action Masking in Policy Gradient Algorithms": https://arxiv.org/abs/2006.14171 . Masking gives a valid policy gradient and scales.
- Cowling, Powley and Whitehouse, "Information Set Monte Carlo Tree Search" (IEEE TCIAIG 2012): https://eprints.whiterose.ac.uk/75048/ . Determinization suffers strategy fusion; ISMCTS searches trees of information sets.
- Anthony, Tian and Barber, "Thinking Fast and Slow with Deep Learning and Tree Search" (NeurIPS 2017, expert iteration): https://arxiv.org/abs/1705.08439
- Silver et al., "A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play" (Science 2018, AlphaZero). Publication details only; the move-selection rule is to be taken from the paper before it is implemented.
- Bastani, Pu and Solar-Lezama, "Verifiable Reinforcement Learning via Policy Extraction" (NeurIPS 2018, VIPER): https://arxiv.org/abs/1805.08328
- Ng, Harada and Russell, "Policy Invariance Under Reward Transformations" (ICML 1999): https://mlanthology.org/icml/1999/ng1999icml-policy/ . Potential-based shaping preserves optimal policies.
- Not researched here and to be checked before use: generalized advantage estimation (Schulman et al., 2015), DAgger (Ross et al., 2011), and any published win-rate figures for the physical card game this one resembles (a search found no reliable figures; one blog simulation could not be retrieved).

## 15. Review log

An independent review of the first draft was run on 15-Nov-2026 with the most capable Claude model (read-only, plan plus code). It found twelve problems. All were taken, and some corrected claims the plan had made.

| # | Finding | Where addressed |
|---|---|---|
| 1 | The "shuffle the unseen cards" belief is exact only for solitaire; with several players the other seats' choices are evidence | 3.2, 5.2, 13 |
| 2 | The exact solver and the "upper bound" were unsound for tables, and the oracle is only a best-found bound | 5.1 |
| 3 | The acceptance bars were self-defeating: "95% of a 2 point gain" is unmeasurable at the planned sample sizes, eight "no worse" tests inflate false failures, and one fixed evaluation set was reused | 8, 10 (with measured noise from section 2) |
| 4 | Stage 3 was not the real defaults (solitaire and two players use hand 7), and the calibration text did not match its table | 2, 4.4 |
| 5 | The observation description was inaccurate, there is no seat position, refill differs by default, and the two ascending (and two descending) piles are interchangeable, which allows conventions | 4.3, 5.3, 3.2 |
| 6 | A moving shaping potential breaks policy invariance; teacher labels must not use privileged data | 3.3, 3.2, 10 |
| 7 | Throughput and cost were underestimated; the parity suite must cover the strategy and features; golden traces miss endgames; estimate omitted work | 2 (measured), 6.1 to 6.2, 12 |
| 8 | Seven first-match rules over three features cannot express a weighted ranking with look-ahead; the end-of-turn decision was missing | 7 |
| 9 | The human test had no power and could not fail | 7, 10 |
| 10 | A static import check is weak (global `fetch`, subprocesses, installs) | 6.3 |
| 11 | The reward decomposition needs win to mean no cards left; the alternative scorings are not independent; graded reward can prefer risky lines | 3.3 |
| 12 | Paper claims were imprecise: the ISMCTS exploration term, the Hanabi claim, the AlphaZero formula | 5.2, 5.4, 14 |

At Ken's direction on 15-Nov-2026 the plan's tool also changed: `packages/engine/src/simulate.ts` gained `scoreGame` (the scoring above, with tests for each of Ken's examples) and records the cards left in the draw pile, and `tools/sim.ts` uses it, so `train` and `calibrate` report the new score. The one saved training run in `tools/runs/` used an earlier scoring (a win at 100 and a loss at up to 50 for the share played).

Changes made at Ken's direction after the review (15-Nov-2026):

| Change | Where |
|---|---|
| Reactions (like, love, really love) were missing from the plan; robots learn to use them through one shared public place, with a grounded meaning | 3.1, 3.2, 5.6, 7, 9, 10, 12, 13 |
| The scoring is now: win 100; a loss is 91 minus the cards left in the hands minus twice the cards left in the draw pile (a first version, halving a loss when the draw pile was not emptied, was judged too harsh; all measured numbers redone) | 2, 3.3, 8 |
| Training runs only on simpler no-cheat tables and is always evaluated on the real defaults | 4.4 |
| Any library at any version may be installed, in an isolated environment | 6.1 |

