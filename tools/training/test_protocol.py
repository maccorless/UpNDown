"""Checks the actor against the rules: legal masks, and that the per-step rewards add up to the game score (plan section 3.3)."""
import os, sys
import numpy as np
from protocol import Actors, RECORD, END, HAND

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'engine')
TABLES = ['s1-solo-79-h9', 's2-2p-79-h7', 's3-4p-99-h7', 's3-solo-99-h7']
GAMES = 64

def phi0(g):
    players, hand, lo, hi = int(g[0]), int(g[1]), int(g[2]), int(g[3])
    cards = hi - lo + 1
    return -(players * hand + 2 * (cards - players * hand))

def main():
    actors = Actors(ENGINE, TABLES, GAMES, 1, 'validation', record=True, reactions=True)
    rng = np.random.default_rng(0)
    totals = {}   # (seed) -> running reward
    starts = {}   # seed -> phi0 of the game
    checked = bad = 0
    rec = actors.current
    seeds = {}
    for e in range(GAMES):
        seeds[e] = None
    first = True
    for rnd in range(4000):
        rec = actors.current
        # a record's reward and finished info belong to the previous action of that slot
        for e in range(GAMES):
            r = rec[e]
            if rnd > 0:
                totals[e] = totals.get(e, 0.0) + float(r['reward'])
                if r['done']:
                    # score from the final cards left: win 100, else 91 - hands - 2 * draw
                    won = r['outcome'] == 1
                    hands_left = int(r['left']) - int(r['draw'])
                    score = 100 if won else 91 - hands_left - 2 * int(r['draw'])
                    got = totals[e] + starts[e]
                    checked += 1
                    if abs(got - score) > 1e-3:
                        bad += 1
                        print('reward mismatch', TABLES[r['table']], 'sum+phi0', got, 'score', score)
                    totals[e] = 0.0
                    starts[e] = phi0(r['globals'])
            if e not in starts:
                starts[e] = phi0(r['globals'])
        mask = rec['mask'].astype(bool)
        assert mask.any(1).all(), 'a position with no legal action'
        # sample a legal action
        noise = rng.random(mask.shape)
        noise[~mask] = -1
        act = noise.argmax(1)
        actors.step(act)
    actors.close()
    print(f'{checked} finished games checked, {bad} reward mismatches')
    sys.exit(1 if bad or checked < 200 else 0)

main()
