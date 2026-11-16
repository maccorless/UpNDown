"""Rules from the network in two parts a person can follow.
 1. Which card on which pile: a linear score over candidate features, fitted to the network's own move scores (its logits, centred on the best move).
 2. Whether to stop after the minimum is met: a small decision tree on features of the position, fitted to the network's choice between ending the turn and playing on.
Positions come from play of the student itself (DAgger): the network labels them, the labels pile up, the student is refitted.
"""
import argparse, os, pickle
import numpy as np
import torch
from sklearn.tree import DecisionTreeClassifier, export_text
import train as tr
import features as ft
import distill as ds
from model import Policy
from protocol import Actors, END

ap = argparse.ArgumentParser()
ap.add_argument('checkpoint'); ap.add_argument('--tables', default='s3-solo-99-h7,s3-2p-99-h7,s3-4p-99-h7')
ap.add_argument('--states', type=int, default=60000); ap.add_argument('--rounds', type=int, default=3)
ap.add_argument('--eval-games', type=int, default=600); ap.add_argument('--stop-depth', type=int, default=4)
ap.add_argument('--ridge', type=float, default=1e-2)
ap.add_argument('--model', default='linear', choices=['linear', 'gbm'])
ap.add_argument('--oracle-stop', action='store_true', help='diagnostic: let the network decide only whether to stop')
ap.add_argument('--oracle-moves', action='store_true', help='diagnostic: let the network pick the move, the tree decide stopping')
args = ap.parse_args()
dev = tr.device()
ck = torch.load(args.checkpoint, map_location=dev)
tier_b = ck['args']['tier'] == 'B'; reactions = ck['args'].get('reactions', False)
teacher = Policy().to(dev); teacher.load_state_dict(ck['policy']); teacher.eval()
tables = args.tables.split(',')
N = {n: i for i, n in enumerate(ds.NAMES)}
PLAY_FEATURES = ['gap', 'backward10', 'skipped', 'stranded', 'fitsAfter', 'regretPile', 'roomAfter', 'ascending'] + (['reactHere'] if reactions else [])
STOP_FEATURES = ['needed', 'playedThisTurn', 'drawFrac', 'handCount', 'players', 'bestGap', 'nCandidates'] + (['reactMax'] if reactions else [])
pidx = [N[n] for n in PLAY_FEATURES]; sidx = [N[n] for n in STOP_FEATURES]
data = []   # per batch: X, mask, logits (cpu)


@torch.no_grad()
def label(rec):
    b = ft.to_tensors(rec, dev)
    X, mask = ds.candidates(b)
    card, pair, pile, glob, record, _ = ft.build(b)
    logits = teacher(card, pair, pile, glob, record, b['mask'])
    return X.cpu(), mask.cpu(), logits.cpu()


class Student:
    def __init__(self):
        self.w = None; self.mu = None; self.sd = None; self.stop = None

    def fit(self):
        X = torch.cat([d[0] for d in data]); M = torch.cat([d[1] for d in data]) > 0.5; L = torch.cat([d[2] for d in data])
        plays = M.clone(); plays[:, END] = False
        best = L.masked_fill(~plays, -1e9).max(1).values
        target = (L - best.view(-1, 1)).clamp(min=-8)
        has_play = plays.any(1)
        P = X[:, :END, :][:, :, pidx][plays[:, :END]]
        y = target[:, :END][plays[:, :END]]
        self.mu, self.sd = P.mean(0), P.std(0).clamp(min=1e-3)
        Z = torch.cat([(P - self.mu) / self.sd, torch.ones(len(P), 1)], 1)
        A = Z.T @ Z + args.ridge * torch.eye(Z.shape[1]); self.w = torch.linalg.solve(A, Z.T @ y)
        if args.model == 'gbm':
            from sklearn.ensemble import HistGradientBoostingRegressor
            self.gbm = HistGradientBoostingRegressor(max_depth=6, max_iter=150, learning_rate=0.1).fit(P.numpy(), y.numpy())
        # stop rule: only where ending is legal and a play also is
        both = M[:, END] & has_play
        S = X[:, END, :][:, sidx][both].numpy()
        stop = (L.argmax(1) == END)[both].numpy()
        self.stop = DecisionTreeClassifier(max_depth=args.stop_depth, min_samples_leaf=100).fit(S, stop) if stop.any() and (~stop).any() else None
        fit_err = ((Z @ self.w - y) ** 2).mean().sqrt().item()
        return fit_err, int(both.sum()), float(stop.mean()) if len(stop) else 0.0

    @torch.no_grad()
    def act(self, rec):
        b = ft.to_tensors(rec, dev)
        X, mask = ds.candidates(b)
        X, mask = X.cpu(), mask.cpu() > 0.5
        B = X.shape[0]
        if args.model == 'gbm':
            s = torch.from_numpy(self.gbm.predict(X[:, :END, :][:, :, pidx].reshape(B * END, -1).numpy()).reshape(B, END).astype(np.float32)).masked_fill(~mask[:, :END], -1e9)
        else:
            Z = torch.cat([(X[:, :END, :][:, :, pidx] - self.mu) / self.sd, torch.ones(B, END, 1)], 2)
            s = (Z @ self.w).masked_fill(~mask[:, :END], -1e9)
        action = s.argmax(1)
        can_end = mask[:, END]
        has_play = mask[:, :END].any(1)
        end = can_end & ~has_play
        both = can_end & has_play
        if args.oracle_stop or args.oracle_moves:
            with torch.no_grad():
                bb = ft.to_tensors(rec, dev)
                card, pair, pile, glob, record, _ = ft.build(bb)
                lg = teacher(card, pair, pile, glob, record, bb['mask']).cpu()
            if args.oracle_moves:
                action = lg[:, :END].argmax(1)
            if args.oracle_stop:
                end[both] = (lg.argmax(1) == END)[both]
                return torch.where(end, torch.full_like(action, END), action).numpy()
        if self.stop is not None and both.any():
            pred = torch.from_numpy(self.stop.predict(X[:, END, :][:, sidx][both].numpy()).astype(bool))
            end[both] = pred
        return torch.where(end, torch.full_like(action, END), action).numpy()


student = Student()
for rnd in range(args.rounds):
    actors = Actors(tr.ENGINE, tables, 512, 4, 'train', record=tier_b, reactions=reactions)
    got = 0
    while got < args.states:
        rec = actors.current
        data.append(label(rec)); got += len(rec)
        actors.step(tr.act(teacher, rec, dev, greedy=True) if rnd == 0 else student.act(rec))
    actors.close()
    err, n_both, stop_rate = student.fit()
    print(f'round {rnd}: {sum(len(d[0]) for d in data)} positions, move-score error {err:.2f}, stop decisions {n_both} (network stops in {stop_rate * 100:.0f}%)', flush=True)
    for t in tables:
        s, w_, l = tr.evaluate(None, t, args.eval_games, tier_b, reactions, dev, act_fn=student.act)
        print(f'  student on {t}: score {s.mean():.2f} won {w_.mean() * 100:.1f}% cards left {l.mean():.2f}', flush=True)
print('\nmove score = sum of weight x feature (higher is better); features in raw units:')
for n, w, sd in sorted(zip(PLAY_FEATURES, (student.w[:-1] / student.sd).tolist(), student.sd.tolist()), key=lambda a: -abs(a[1] * a[2])):
    print(f'  {n:12s} {w:+.3f}')
if student.stop is not None:
    print('\nstop rule (1 = end the turn):')
    print(export_text(student.stop, feature_names=STOP_FEATURES))
pickle.dump({'w': student.w, 'mu': student.mu, 'sd': student.sd, 'stop': student.stop, 'play_features': PLAY_FEATURES, 'stop_features': STOP_FEATURES}, open(os.path.join(os.path.dirname(args.checkpoint), 'student2.pkl'), 'wb'))
