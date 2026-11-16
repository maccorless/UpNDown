"""A linear score over candidate features, trained to pick the network's move (a conditional logit). Easy to print as a rule: play the move with the highest
score. Reports how often it agrees with the network and how it plays."""
import argparse
import numpy as np
import torch
import train as tr
import features as ft
import distill as ds
from model import Policy
from protocol import Actors

ap = argparse.ArgumentParser()
ap.add_argument('checkpoint'); ap.add_argument('--tables', default='s3-solo-99-h7,s3-2p-99-h7,s3-4p-99-h7')
ap.add_argument('--states', type=int, default=60000); ap.add_argument('--rounds', type=int, default=3); ap.add_argument('--eval-games', type=int, default=600)
ap.add_argument('--hidden', type=int, default=0, help='0 = linear; otherwise one hidden layer of this width')
args = ap.parse_args()
dev = tr.device()
ck = torch.load(args.checkpoint, map_location=dev)
tier_b = ck['args']['tier'] == 'B'; reactions = ck['args'].get('reactions', False)
teacher = Policy().to(dev); teacher.load_state_dict(ck['policy']); teacher.eval()
tables = args.tables.split(',')
K = ds.K
net = (torch.nn.Linear(K, 1) if args.hidden == 0 else torch.nn.Sequential(torch.nn.Linear(K, args.hidden), torch.nn.ReLU(), torch.nn.Linear(args.hidden, 1))).to(dev)
mean = torch.zeros(K, device=dev); std = torch.ones(K, device=dev)
data = []   # (X [B,45,K] cpu, mask [B,45], pick [B], weight [B])

def collect(actors, rnd, got_target):
    got = 0
    while got < got_target:
        rec = actors.current
        b = ft.to_tensors(rec, dev)
        X, mask = ds.candidates(b)
        with torch.no_grad():
            card, pair, pile, glob, record, _ = ft.build(b)
            logits = teacher(card, pair, pile, glob, record, b['mask'])
            lp = torch.log_softmax(logits, 1); top2 = lp.topk(2, 1).values
            w = (top2[:, 0] - top2[:, 1]).clamp(max=5) + 0.05
        data.append((X.cpu(), mask.cpu(), logits.argmax(1).cpu(), w.cpu()))
        got += len(rec)
        actors.step(tr.act(teacher, rec, dev, greedy=True) if rnd == 0 else student_act(rec))

def scores(X):
    return net(((X - mean) / std)).squeeze(-1)

@torch.no_grad()
def student_act(rec):
    b = ft.to_tensors(rec, dev)
    X, mask = ds.candidates(b)
    s = scores(X).masked_fill(mask < 0.5, -1e9)
    return s.argmax(1).cpu().numpy()

def fit(epochs=60):
    global mean, std
    X = torch.cat([d[0] for d in data]).to(dev); M = torch.cat([d[1] for d in data]).to(dev); P = torch.cat([d[2] for d in data]).to(dev); W = torch.cat([d[3] for d in data]).to(dev)
    flat = X[M > 0.5]
    mean, std = flat.mean(0), flat.std(0).clamp(min=1e-3)
    opt = torch.optim.Adam(net.parameters(), lr=0.01)
    for _ in range(epochs):
        perm = torch.randperm(len(X), device=dev)
        for i in range(0, len(X), 8192):
            idx = perm[i:i + 8192]
            s = scores(X[idx]).masked_fill(M[idx] < 0.5, -1e9)
            loss = (torch.nn.functional.cross_entropy(s, P[idx], reduction='none') * W[idx]).mean()
            opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        s = scores(X).masked_fill(M < 0.5, -1e9)
        return (s.argmax(1) == P).float().mean().item()

for rnd in range(args.rounds):
    actors = Actors(tr.ENGINE, tables, 512, 4, 'train', record=tier_b, reactions=reactions)
    collect(actors, rnd, args.states)
    actors.close()
    agree = fit()
    print(f'round {rnd}: {sum(len(d[0]) for d in data)} positions, agrees with the network on {agree * 100:.1f}%', flush=True)
    for t in tables:
        s, w_, l = tr.evaluate(None, t, args.eval_games, tier_b, reactions, dev, act_fn=student_act)
        print(f'  student on {t}: score {s.mean():.2f} won {w_.mean() * 100:.1f}% cards left {l.mean():.2f}', flush=True)
if args.hidden == 0:
    w = (net.weight.detach().cpu().flatten() / std.cpu()).numpy()
    print('weights (per unit of each feature, higher = better move):')
    for n, x in sorted(zip(ds.NAMES, w), key=lambda a: -abs(a[1])):
        print(f'  {n:14s} {x:+.3f}')
