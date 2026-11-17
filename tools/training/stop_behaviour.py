"""When does the trained network keep playing after the minimum? Looks at every position where it could end its turn and could also play on, and records how big the
best available move is, how far into the game it is (share of the draw pile left), whether a teammate has marked that pile, and what the network chose."""
import sys
import numpy as np, torch
import train as tr, features as ft, distill as ds
from model import Policy
from protocol import Actors, END

ck = torch.load(sys.argv[1], map_location=tr.device())
dev = tr.device()
net = Policy(ck['args'].get('width', 64)).to(dev); net.load_state_dict(ck['policy']); net.eval()
tier_b = ck['args']['tier'] == 'B'
N = {n: i for i, n in enumerate(ds.NAMES)}
rows = []   # (steps, backward, drawShare, reactLevel, continued)
for table in ('s3-2p-99-h7', 's3-4p-99-h7'):
    actors = Actors(tr.ENGINE, [table], 512, 4, 'train', record=tier_b, reactions=True, seat_mix=0.5)
    for _ in range(220):
        rec = actors.current
        b = ft.to_tensors(rec, dev)
        X, mask = ds.candidates(b)
        with torch.no_grad():
            card, pair, pile, glob, record, _ = ft.build(b)
            logits = net(card, pair, pile, glob, record, b['mask'])
        X, mask, logits = X.cpu(), mask.cpu() > 0.5, logits.cpu()
        plays = mask.clone(); plays[:, END] = False
        both = mask[:, END] & plays.any(1)
        if both.any():
            best = logits.masked_fill(~plays, -1e9).argmax(1)
            idx = both.nonzero().flatten()
            span = (rec['globals'][:, 3].astype(float) - rec['globals'][:, 2] + 1)
            for i in idx.tolist():
                a = int(best[i])
                steps = float(X[i, a, N['gap']]); back = bool(X[i, a, N['backward10']] > 0)
                share = float(rec['globals'][i, 6]) / span[i]
                react = int(rec['react'][i, :, a % 4].max())
                rows.append((steps, back, share, react, int(logits[i].argmax()) != END))
        actors.step(logits.argmax(1).numpy())
    actors.close()
R = np.array(rows, dtype=float)
print(f'{len(R)} positions where ending the turn and playing on were both possible; network kept playing in {R[:, 4].mean() * 100:.0f}%')
fw = R[R[:, 1] == 0]
bk = R[R[:, 1] == 1]
print(f'  backward 10 available as the best move: {len(bk)} positions, kept playing in {bk[:, 4].mean() * 100:.0f}%')
def table_by(col, edges, labels, title):
    print(f'\nkept playing (%), by size of the best forward move, {title}')
    steps_edges = [(0, 1), (2, 2), (3, 3), (4, 5), (6, 8), (9, 99)]
    print('  steps      ' + '  '.join(f'{l:>12}' for l in labels))
    for lo, hi in steps_edges:
        cells = []
        for (a, b2) in edges:
            m = (fw[:, 0] >= lo) & (fw[:, 0] <= hi) & (fw[:, col] >= a) & (fw[:, col] <= b2)
            cells.append(f'{fw[m, 4].mean() * 100:5.0f}% (n={int(m.sum()):5d})' if m.sum() >= 30 else '           -')
        print(f'  {lo if lo == hi else f"{lo}-{hi}":>6}     ' + '  '.join(f'{c:>12}' for c in cells))
table_by(2, [(0.0001, 0.3), (0.3, 0.6), (0.6, 1.0)], ['late <30%', 'middle', 'early >60%'], 'by how much of the draw pile is left')
table_by(3, [(0, 0), (1, 1), (2, 2), (3, 3)], ['no mark', 'like', 'love', 'really love'], 'by the strongest teammate mark on that pile')
