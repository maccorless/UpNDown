Created: 17-Nov-2026 08:22 IST

# How to play UpNDown well: what the measurements say

Everything here was measured by playing thousands of games on a computer (validation deals, the default settings: a deck of 2 to 99, hands of 7). "Score" is 100 for a win, otherwise 91 minus cards left in hands minus twice the cards left in the draw pile. These are numbers for a program following the rules exactly; a person will do worse, and the guide says where it matters.

## The five rules the written strategy uses, ranked by what they are worth

Measured by switching each rule off and replaying the same 3,000 deals (written strategy: solitaire 50.9, two players 76.0, four players 88.6).

| Rule | What happens without it |
|---|---|
| **1. Play the smallest move.** On each pile, prefer the card that takes it the least distance. | Collapses: nearly every game is lost (two players 3.0, four players 19.4). This is the heart of the game. |
| **2. Stop when you have played your minimum**, unless the next move is tiny (about 3 steps or less) or a backward 10. | Two players 54.1 (down 21.9), four players 76.0 (down 12.6). Playing on after your minimum with a big move spends room the next player needed. Solitaire has no turns, so this does not apply there. |
| **3. Look ahead through your hand.** Prefer the play after which more of your other cards can still be played in a row, with small moves. | Down 4.3 in solitaire, 2.6 with two players, 2.9 with four. |
| **4. Use the backward 10.** A card exactly 10 below an ascending pile (or 10 above a descending one) sets the pile back for free. Treat it as a bonus. | Down about 1 point at every table. |
| **5. Do not jump over your own cards.** Playing a card past another card of yours on the same pile makes that one unplayable there. | Down 0.3 to 0.4. Small, but free to follow. |
| Avoid stranding a card (leaving one with no pile that takes it) | Worth almost nothing once the others are followed (under 0.1). |

## Counting cards (the played-card record)

A network trained with the list of cards already played played clearly better at tables: with two players about 4 points more than a network that only sees the piles, and with four players about 3 points more, even when the other players' reactions are slow or missing. The one idea that carried the gain is **how many cards you cannot account for sit between the pile's top and the card you are about to play**: cards neither in your hand nor already played could still turn up, and playing past them makes them dead on that pile. The written strategy with just that one term added gained 0.8 points with four players and nothing elsewhere, so the full benefit comes from using it together with everything else. If your table's app lets you look through played cards, use it; otherwise keep count of high and low cards as they go down.

## Reactions: what they should mean, and when to trust them

The game lets a player who is not on turn mark a pile with like, love or really love. The meaning that works is the one How to Play already gives: **"I hold a great card for this pile"**, and the level should rise as your best card for that pile gets closer to its top:

- really love: a backward 10, or a card within about 3 steps of the top (roughly 3% of the deck);
- love: within about 6 steps (6%);
- like: within about 12 steps (12%);
- nothing otherwise.

If a teammate has marked a pile, **do not take that pile with a big move unless the move is tiny or a backward 10**; play elsewhere or end your turn.

How much this is worth depends entirely on how current the marks are. With exact, up-to-the-play marks from every other seat, programs gained 2 to 17 points at tables. When marks are one play old the advantage mostly vanishes, and at three plays old a program that trusts them plays worse than one that ignores them. So: **update your marks after every card, and treat a teammate's mark as worth acting on only if it is current.** A network trained on a mix of reliable and unreliable seats (and told which is which) kept most of the gain at all-robot tables and lost nothing at all-human ones.

## What a computer found that this guide cannot give you

The best computer players are well ahead of the written strategy: solitaire about 58 to 61 (written 50.9), two players 88 to 92 (written 76.0), four players 97 to 99 (written 88.6) with 85 to 90% wins, depending on how good the reactions are. We could not reduce what they do to rules a person can follow: simple rules built from move size, jumped cards and stranded cards only reach the written strategy's level, and almost all the difference is in which card a computer chooses, not in when it stops. In solitaire on the default settings a program still wins only about 2 to 6% of games; those settings are very hard, and a hand of 11 instead of 7 lifts the written strategy from 1% to 74% wins.
