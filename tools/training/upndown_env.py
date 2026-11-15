"""A fast port of the UpNDown rules (no cheats), vectorised over many games with numba.

Layout per game: hands[p, slot] is a card value (0 = empty slot), tops[4] are the pile tops (piles 0 and 1 ascend,
2 and 3 descend), ptr is how many cards of the fixed deck order have been drawn. It is checked against the TypeScript
engine on recorded games (see parity.py), so it must not be changed without running that.
"""
import numpy as np
from numba import njit, prange

PLAYING, WON, LOST = 0, 1, 2
END_TURN = -1  # action code; a play is slot * 4 + pile


@njit(cache=True)
def _valid(card, pile, top):
    if pile < 2:
        return card > top or card == top - 10
    return card < top or card == top + 10


@njit(cache=True)
def _count(hands, e, p):
    n = 0
    for s in range(hands.shape[2]):
        if hands[e, p, s] != 0:
            n += 1
    return n


@njit(cache=True)
def _required(per_turn, draw_left):
    return 1 if draw_left == 0 else per_turn


@njit(cache=True)
def _draw_to_hand(hands, decks, ptr, e, p, hand_size):
    n = _count(hands, e, p)
    for s in range(hands.shape[2]):
        if n >= hand_size or ptr[e] >= decks.shape[1]:
            return
        if hands[e, p, s] == 0:
            hands[e, p, s] = decks[e, ptr[e]]
            ptr[e] += 1
            n += 1


@njit(cache=True)
def _evaluate(hands, tops, decks, ptr, cur, played, phase, e, per_turn, solitaire):
    players = hands.shape[1]
    empty = True
    for p in range(players):
        if _count(hands, e, p) > 0:
            empty = False
            break
    if empty:
        phase[e] = WON
        return
    can = False
    for s in range(hands.shape[2]):
        c = hands[e, cur[e], s]
        if c != 0:
            for pile in range(4):
                if _valid(c, pile, tops[e, pile]):
                    can = True
    if can:
        return
    if solitaire:
        phase[e] = LOST
        return
    if played[e] < _required(per_turn, decks.shape[1] - ptr[e]):
        phase[e] = LOST


@njit(cache=True)
def reset(decks, hands, tops, ptr, cur, played, phase, hand_size, lo, hi, per_turn, solitaire):
    E = decks.shape[0]
    players = hands.shape[1]
    for e in range(E):
        hands[e, :, :] = 0
        ptr[e] = 0
        for r in range(hand_size):
            for p in range(players):
                if ptr[e] < decks.shape[1]:
                    hands[e, p, r] = decks[e, ptr[e]]
                    ptr[e] += 1
        tops[e, 0] = lo - 1
        tops[e, 1] = lo - 1
        tops[e, 2] = hi + 1
        tops[e, 3] = hi + 1
        cur[e] = 0
        played[e] = 0
        phase[e] = PLAYING
        _evaluate(hands, tops, decks, ptr, cur, played, phase, e, per_turn, solitaire)


@njit(cache=True)
def step(actions, decks, hands, tops, ptr, cur, played, phase, hand_size, per_turn, refill, solitaire):
    """Apply one action to every game that is still being played. Returns the number of illegal actions (a bug if not 0)."""
    bad = 0
    players = hands.shape[1]
    for e in range(decks.shape[0]):
        if phase[e] != PLAYING:
            continue
        a = actions[e]
        p = cur[e]
        if a == END_TURN:
            if solitaire or played[e] < _required(per_turn, decks.shape[1] - ptr[e]):
                bad += 1
                continue
            played[e] = 0
            if not refill:
                _draw_to_hand(hands, decks, ptr, e, p, hand_size)
            nxt = p
            allempty = True
            for q in range(players):
                if _count(hands, e, q) > 0:
                    allempty = False
            if not allempty:
                for off in range(1, players + 1):
                    idx = (p + off) % players
                    if _count(hands, e, idx) > 0:
                        nxt = idx
                        break
            cur[e] = nxt
        else:
            slot = a // 4
            pile = a % 4
            card = hands[e, p, slot]
            if card == 0 or not _valid(card, pile, tops[e, pile]):
                bad += 1
                continue
            hands[e, p, slot] = 0
            tops[e, pile] = card
            played[e] += 1
            if solitaire or refill:
                _draw_to_hand(hands, decks, ptr, e, p, hand_size)
        _evaluate(hands, tops, decks, ptr, cur, played, phase, e, per_turn, solitaire)
    return bad


@njit(cache=True, parallel=True)
def legal_and_observe(hands, tops, ptr, cur, played, phase, decks, per_turn, solitaire, obs, mask):
    """Fill obs[E, F] (what the player on turn sees) and mask[E, H*4+1] (legal actions)."""
    E = hands.shape[0]
    H = hands.shape[2]
    players = hands.shape[1]
    for e in prange(E):
        p = cur[e]
        mask[e, :] = False
        draw_left = decks.shape[1] - ptr[e]
        for s in range(H):
            c = hands[e, p, s]
            obs[e, s] = c / 100.0
            obs[e, H + s] = 1.0 if c != 0 else 0.0
            if c != 0 and phase[e] == PLAYING:
                for pile in range(4):
                    if _valid(c, pile, tops[e, pile]):
                        mask[e, s * 4 + pile] = True
        for k in range(4):
            obs[e, 2 * H + k] = tops[e, k] / 100.0
        obs[e, 2 * H + 4] = draw_left / 100.0
        obs[e, 2 * H + 5] = played[e] / 10.0
        obs[e, 2 * H + 6] = _required(per_turn, draw_left) / 10.0
        for q in range(1, 6):
            obs[e, 2 * H + 6 + q] = 0.0
        for off in range(1, players):
            obs[e, 2 * H + 6 + off] = _count(hands, e, (p + off) % players) / 10.0
        if phase[e] == PLAYING and not solitaire and played[e] >= _required(per_turn, draw_left):
            mask[e, H * 4] = True
