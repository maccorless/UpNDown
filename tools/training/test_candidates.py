"""Candidate features against a slow loop version written straight from the rules."""
import os
import numpy as np, torch
from protocol import Actors, HAND
import features as ft, distill as ds

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'engine')
actors = Actors(ENGINE, ['s3-4p-99-h7', 's3-solo-99-h7', 's2-2p-79-h7'], 64, 1, 'validation')
rng = np.random.default_rng(3)
for _ in range(25):   # advance a little so positions are not all openings
    m = actors.current['mask'].astype(bool); r = rng.random(m.shape); r[~m] = -1; actors.step(r.argmax(1))
rec = actors.current; actors.close()
b = ft.to_tensors(rec, 'cpu')
X, mask = ds.candidates(b)
valid = lambda v, t, asc: (v > t or v == t - 10) if asc else (v < t or v == t + 10)
bad = checked = 0
N = {n: i for i, n in enumerate(ds.NAMES)}
for e in range(64):
    hand = [int(v) for v in rec['hand'][e] if v > 0]
    tops = [int(v) for v in rec['tops'][e]]
    asc = [True, True, False, False]
    for i, v in enumerate(rec['hand'][e]):
        if v == 0: continue
        for j in range(4):
            if not mask[e, i * 4 + j]: continue
            new = tops.copy(); new[j] = int(v)
            others = [int(w) for k, w in enumerate(rec['hand'][e]) if w > 0 and k != i]
            stranded = sum(1 for w in others if not any(valid(w, new[m], asc[m]) for m in range(4)))
            fits = sum(1 for w in others if valid(w, new[j], asc[j]))
            skipped = 0 if (tops[j] - 10 == v if asc[j] else tops[j] + 10 == v) else sum(1 for w in others if ((tops[j] < w < v and w != v - 10) if asc[j] else (v < w < tops[j] and w != v + 10)))
            row = X[e, i * 4 + j]
            checked += 1
            for name, want in (('stranded', stranded), ('fitsAfter', fits), ('skipped', skipped)):
                if abs(float(row[N[name]]) - want) > 1e-4:
                    bad += 1; print('mismatch', name, 'got', float(row[N[name]]), 'want', want)
print(f'{checked} candidates checked, {bad} mismatches')
assert bad == 0
