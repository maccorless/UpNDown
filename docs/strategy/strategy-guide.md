Created: 17-Nov-2026 08:22 IST

# How to play UpNDown well: what the measurements say

Everything here was measured by playing thousands of games on a computer (validation deals, the default settings: a deck of 2 to 99, hands of 7). "Score" is 100 for a win, otherwise 91 minus cards left in hands minus twice the cards left in the draw pile. These are numbers for a program following the rules exactly; a person will do worse, and the guide says where it matters.

## The five rules the written strategy uses, ranked by what they are worth

Measured by switching each rule off and replaying the same 3,000 deals (written strategy: solitaire 50.9, two players 76.0, four players 88.6).

| Rule | What happens without it |
|---|---|
| **1. Play the smallest move.** On each pile, prefer the card that takes it the least distance. | Collapses: nearly every game is lost (two players 3.0, four players 19.4). This is the heart of the game. |
| **2. Stop when you have played your minimum**, unless the next move is tiny or a backward 10 (see "When to play on" below). | Two players 54.1 (down 21.9), four players 76.0 (down 12.6). Playing on after your minimum with a big move spends room the next player needed. Solitaire has no turns, so this does not apply there. |
| **3. Look ahead through your hand.** Prefer the play after which more of your other cards can still be played in a row, with small moves. | Down 4.3 in solitaire, 2.6 with two players, 2.9 with four. |
| **4. Use the backward 10.** A card exactly 10 below an ascending pile (or 10 above a descending one) sets the pile back for free. Treat it as a bonus. | Down about 1 point at every table. |
| **5. Do not jump over your own cards.** Playing a card past another card of yours on the same pile makes that one unplayable there. | Down 0.3 to 0.4. Small, but free to follow. |
| Avoid stranding a card (leaving one with no pile that takes it) | Worth almost nothing once the others are followed (under 0.1). |

## The pair rule: a card and the card ten below it in your own hand

If your hand holds a card and the card exactly ten below it (3 and 13 on an up pile), **never play the lower one the ordinary way first.** Play the cards up to the higher one, then the higher one, and last the lower one as a backward 10: the pile ends on 3 instead of 13 for the same cards. On a down pile it is the mirror: play the lower card first and the higher one last. This is about your own hand, not a guess about the draw pile.

Measured on the same deals, adding it to the written strategy: solitaire 50.9 to 62.0 (+11.0), two players 76.0 to 82.8 (+6.8), four players 88.6 to 90.8 (+2.2), and a small 9-card solitaire deck 83.7 to 91.5. The first network (trained without the rule) did not find it by itself: forcing the rule on that network made it play worse (two players 92.1 to 88.3), so the network has to be trained with the rule in place. When a hand holds several pairs at once (3 and 13 as well as 5 and 15) only one can be finished on a pile, and the written strategy handles that crudely.

## When to play on after your minimum

Once you have played the minimum, stop unless the best move you have left is **tiny** or a **backward 10**. Measured on 3,000 deals per table with honest, up-to-date reactions (the written strategy with a stricter or looser meaning of "tiny"; fixed 3 steps scored two players 80.6 and four players 91.0):

| How "tiny" depends on what teammates have marked on that pile | Two players | Four players |
|---|---|---|
| Always 3 steps (the written strategy) | 80.6 | 91.0 |
| **No mark: 4 steps. Like: 6. Love: 3. Really love: not at all (only a backward 10)** | **86.1 (+5.4)** | **93.2 (+2.2)** |
| Same, but like only 1 step (the "tighten when anyone likes it" idea) | 81.0 (+0.4) | 90.7 (-0.2) |
| Same as the best row but making it depend on how early the game is (4 early, 2 late) | 85.1 (+4.4) | 92.4 (+1.5), a little worse than without |

What this says:

- **A backward 10 is always worth playing.** The trained computer players kept playing in 100% of the 11,000 positions where a backward 10 was their best move.
- **A "really love" mark on a pile means leave it.** Even a 1-step move on a pile a teammate really loves was played by the trained players only 45% of the time (92% with no mark).
- **A plain "like" is not a reason to stop.** It is a reason to play on a little more, up to about 6 steps, and the computer players agree (98% played a 1-step move on a liked pile).
- **"Love" sits in between:** up to about 3 steps.
- **Early or late in the game does not need its own rule.** The trained players do keep playing a bit more early (about 4 steps early, 2 late), but a rule built on it gained nothing measurable (and was slightly worse together with the marks).
- **Setting up a backward 10** (playing a bigger move because a card in your hand is exactly 10 below the new top) gained nothing measurable on top of the above (+0.1 to +0.3, not significant), so it is not a rule. With no reactions in play it gained +0.3 at two players and nothing at four.
- These are for tables where marks are honest and current, as robots keep them. A mark that is several plays old can mislead, so with slow human marks expect less.

## Counting cards (the played-card record)

A network trained with the list of cards already played played clearly better at tables: with two players about 4 points more than a network that only sees the piles, and with four players about 3 points more, even when the other players' reactions are slow or missing. The one idea that carried the gain is **how many cards you cannot account for sit between the pile's top and the card you are about to play**: cards neither in your hand nor already played could still turn up, and playing past them makes them dead on that pile. The written strategy with just that one term added gained 0.8 points with four players and nothing elsewhere, so the full benefit comes from using it together with everything else. If your table's app lets you look through played cards, use it; otherwise keep count of high and low cards as they go down.

## Reactions: what they should mean, and when to trust them

The game lets a player who is not on turn mark a pile with like, love or really love. The meaning that works is the one How to Play already gives: **"I hold a great card for this pile"**, and the level should rise as your best card for that pile gets closer to its top:

- really love: a backward 10 only (so it always means "leave this pile to me");
- love: a card within about 2 steps of the top (3% of the deck);
- like: within about 10 steps (10.5% of the deck);
- nothing otherwise.

If a teammate has marked a pile, **do not take that pile with a big move unless the move is tiny or a backward 10**; play elsewhere or end your turn.

How much this is worth depends entirely on how current the marks are. With exact, up-to-the-play marks from every other seat, programs gained 2 to 17 points at tables. When marks are one play old the advantage mostly vanishes, and at three plays old a program that trusts them plays worse than one that ignores them. So: **update your marks after every card, and treat a teammate's mark as worth acting on only if it is current.** A network trained on a mix of reliable and unreliable seats (and told which is which) kept most of the gain at all-robot tables and lost nothing at all-human ones.

## What a computer found that this guide cannot give you

The best computer players are well ahead of the written strategy: solitaire about 58 to 61 (written 50.9), two players 88 to 92 (written 76.0), four players 97 to 99 (written 88.6) with 85 to 90% wins, depending on how good the reactions are. We could not reduce what they do to rules a person can follow: simple rules built from move size, jumped cards and stranded cards only reach the written strategy's level, and almost all the difference is in which card a computer chooses, not in when it stops. In solitaire on the default settings a program still wins only about 2 to 6% of games; those settings are very hard, and a hand of 11 instead of 7 lifts the written strategy from 1% to 74% wins.
