"""The 'unseen cards jumped over' feature against a plain loop written from its definition (Tier B: record present)."""
import os
import numpy as np
from protocol import Actors
import features as ft

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'engine')
actors = Actors(ENGINE, ['s3-4p-99-h7', 's3-solo-99-h7'], 64, 1, 'validation', record=True)
rng = np.random.default_rng(5)
for _ in range(30):
    m = actors.current['mask'].astype(bool); r = rng.random(m.shape); r[~m] = -1; actors.step(r.argmax(1))
rec = actors.current; actors.close()
b = ft.to_tensors(rec, 'cpu')
pair = ft.build(b)[1]
bad = checked = 0
for e in range(64):
    lo, hi = int(rec['globals'][e][2]), int(rec['globals'][e][3])
    hand = {int(v) for v in rec['hand'][e] if v > 0}
    played = {v for v in range(100) if rec['played'][e][v]}
    unseen = {v for v in range(lo, hi + 1) if v not in hand and v not in played}
    tops = [int(v) for v in rec['tops'][e]]
    for i, v in enumerate(rec['hand'][e]):
        if v == 0: continue
        for j in range(4):
            if not rec['mask'][e][i * 4 + j]: continue
            t, asc = tops[j], j < 2
            back = (v == t - 10) if asc else (v == t + 10)
            want = 0 if back else len([w for w in unseen if (t < w < v if asc else v < w < t)]) / 10.0
            got = float(pair[e, i, j, 4])
            checked += 1
            if abs(got - want) > 1e-5:
                bad += 1; print('mismatch', e, int(v), j, 'got', got, 'want', want)
print(f'{checked} (card, pile) pairs checked, {bad} mismatches'); assert bad == 0 and checked > 200
