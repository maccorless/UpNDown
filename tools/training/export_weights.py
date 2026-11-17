"""Writes a trained policy as JSON for the TypeScript network (packages/engine/src/network.ts), and parity fixtures to check that network against this one.

  ./sandboxed.sh uv run --offline python export_weights.py runs/b3/end-mix123.pt ../../packages/engine/models/robot.json [--fixtures ../../packages/engine/test/fixtures/network-robot.json]
"""
import argparse, json, os
import numpy as np
import torch
import train as tr
import features as ft
from model import Policy
from protocol import Actors

ap = argparse.ArgumentParser()
ap.add_argument('checkpoint'); ap.add_argument('out')
ap.add_argument('--fixtures', default=None); ap.add_argument('--n', type=int, default=60)
args = ap.parse_args()
ck = torch.load(args.checkpoint, map_location='cpu')
width = ck['args'].get('width', 64)
policy = Policy(width); policy.load_state_dict(ck['policy']); policy.eval()
tensors = {k: {'shape': list(v.shape), 'data': [round(float(x), 6) for x in v.detach().flatten()]} for k, v in policy.state_dict().items()}
meta = {'width': width, 'tierB': ck['args']['tier'] == 'B', 'reactions': bool(ck['args'].get('reactions', False)), 'trainedSteps': ck.get('steps'), 'source': os.path.basename(os.path.dirname(args.checkpoint))}
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
json.dump({**meta, 'tensors': tensors}, open(args.out, 'w'), separators=(',', ':'))
print(f'wrote {args.out}: {os.path.getsize(args.out) / 1e6:.2f} MB, width {width}, {sum(p.numel() for p in policy.parameters())} numbers')

if args.fixtures:
    tables = ['s3-4p-99-h7', 's3-2p-99-h7', 's3-solo-99-h7', 's2-4p-79-h7']
    actors = Actors(tr.ENGINE, tables, 64, 2, 'validation', record=meta['tierB'], reactions=meta['reactions'], seat_mix=0.5)
    rng = np.random.default_rng(11)
    for _ in range(25):
        m = actors.current['mask'].astype(bool); r = rng.random(m.shape); r[~m] = -1; actors.step(r.argmax(1))
    rec = actors.current[: args.n]
    actors.close()
    b = ft.to_tensors(rec, 'cpu')
    card, pair, pile, glob, record, _ = ft.build(b)
    with torch.no_grad():
        logits = policy(card, pair, pile, glob, record, b['mask'])
    cases = []
    for i in range(len(rec)):
        legal = [int(a) for a in np.nonzero(rec['mask'][i])[0]]
        cases.append({
            'hand': rec['hand'][i].tolist(), 'tops': rec['tops'][i].tolist(), 'globals': rec['globals'][i].tolist(), 'others': rec['others'][i].tolist(),
            'react': rec['react'][i].flatten().tolist(), 'seatKind': rec['seatKind'][i].tolist(), 'played': rec['played'][i].tolist(),
            'mask': rec['mask'][i].tolist(), 'logits': {str(a): round(float(logits[i, a]), 5) for a in legal}})
    os.makedirs(os.path.dirname(os.path.abspath(args.fixtures)), exist_ok=True)
    json.dump({'meta': meta, 'cases': cases}, open(args.fixtures, 'w'), separators=(',', ':'))
    print(f'wrote {len(cases)} fixtures to {args.fixtures}')
