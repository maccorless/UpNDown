"""Distilling the network into rules a person can follow (plan section 5.5).

Every candidate move (and 'end the turn') becomes a row of features a person can work out at the table: the size of the move, whether it is a
backward 10, how many cards in hand it jumps over, how many it leaves with nowhere to go, and so on. A small decision tree learns which
candidate the network picks. The tree's choice at each position is its most likely candidate. Data comes from the positions the tree itself
reaches (DAgger): the network labels them, the labels pile up, and the tree is refitted.

  ./sandboxed.sh uv run --offline python distill.py runs/a1c/end-mix123.pt --depth 8 --rounds 3
"""
import os
# Cap PyTorch's GPU memory cache. Its default ceiling (about 1.7 x the recommended working set, ~80 GB on this 64 GB Mac) is above physical memory, so the cache grows until
# the machine swaps and every run slows to a crawl. These must be set before the first GPU allocation.
os.environ.setdefault('PYTORCH_MPS_HIGH_WATERMARK_RATIO', '0.35')
os.environ.setdefault('PYTORCH_MPS_LOW_WATERMARK_RATIO', '0.25')
import argparse, os
import numpy as np
import torch
from sklearn.tree import DecisionTreeClassifier
import train as tr
import features as ft
from model import Policy
from protocol import Actors, HAND, END

NAMES = ['isEnd', 'gap', 'gapFrac', 'backward10', 'skipped', 'stranded', 'fitsAfter', 'regretPile', 'regretAll', 'roomAfter', 'ascending',
         'needed', 'playedThisTurn', 'drawFrac', 'handCount', 'players', 'solitaire', 'nCandidates', 'reactHere', 'reactMax', 'bestGap']
K = len(NAMES)


@torch.no_grad()
def candidates(b):
    """[B,45,K] candidate features computed only from what the player sees, and the [B,45] legal mask."""
    hand, tops, g, mask = b['hand'], b['tops'], b['globals'], b['mask']
    B = hand.shape[0]
    dev = hand.device
    span = (g[:, 3] - g[:, 2] + 1).clamp(min=1)
    kind = ft.KIND.to(dev).view(1, 1, 4)
    asc = kind > 0.5
    v = hand.view(B, HAND, 1)
    t = tops.view(B, 1, 4)
    valid = mask[:, :HAND * 4].view(B, HAND, 4) > 0.5
    back10 = torch.where(asc, v == t - 10, v == t + 10) & valid
    gap = torch.where(back10, torch.zeros_like(v - t), torch.where(asc, v - t, t - v).abs()) * valid
    big = torch.full_like(gap, 1e4)
    gap_v = torch.where(valid, gap, big)
    # cards jumped over
    w = hand.view(B, 1, 1, HAND)
    wp = (hand > 0).view(B, 1, 1, HAND)
    vv, tt = v.view(B, HAND, 1, 1), t.view(B, 1, 4, 1)
    between = torch.where(asc.view(1, 1, 4, 1), (w > tt) & (w < vv) & (w != vv - 10), (w < tt) & (w > vv) & (w != vv + 10)) & wp
    skipped = between.sum(-1) * (~back10)
    # after playing card i on pile j: the pile top becomes v_i; which other cards still have a legal pile, and which fit pile j
    newtop = v.view(B, HAND, 1, 1).expand(B, HAND, 4, 1)                    # [B,i,j,1] value of the played card
    tops_after = tops.view(B, 1, 1, 4).expand(B, HAND, 4, 4).clone()        # [B,i,j,m]
    onehot_j = torch.eye(4, device=dev).view(1, 1, 4, 4).bool().expand(B, HAND, 4, 4)
    tops_after = torch.where(onehot_j, newtop.expand(B, HAND, 4, 4), tops_after)
    wk = hand.view(B, 1, 1, HAND, 1)                                        # card k
    ta = tops_after.unsqueeze(3)                                            # [B,i,j,1,m]
    ascm = asc.view(1, 1, 1, 1, 4)
    ok = torch.where(ascm, (wk > ta) | (wk == ta - 10), (wk < ta) | (wk == ta + 10)) & (wk > 0)   # [B,i,j,k,m]
    notself = (~torch.eye(HAND, device=dev).bool()).view(1, HAND, 1, HAND, 1)
    other = notself & (hand.view(B, 1, 1, HAND, 1) > 0)
    playable_k = (ok & other).any(-1)                                       # [B,i,j,k]
    stranded = ((~playable_k) & other.squeeze(-1)).sum(-1)
    fits_after = torch.stack([(ok[:, :, j, :, j] & other[:, :, 0, :, 0]).sum(-1) for j in range(4)], 2)
    regret_pile = gap_v - gap_v.min(-1, keepdim=True).values
    best_gap = gap_v.flatten(1).min(1).values
    regret_all = gap_v - best_gap.view(B, 1, 1)
    room = torch.where(asc, g[:, 3].view(B, 1, 1) - v, v - g[:, 2].view(B, 1, 1)) / span.view(B, 1, 1)
    needed = (g[:, 8] - g[:, 7]).clamp(min=0)
    n_cand = (mask[:, :HAND * 4].sum(1) + mask[:, END])
    react = b['react']                                                      # [B,5,4]
    react_here = react.max(1).values.view(B, 1, 4).expand(B, HAND, 4)
    ctx = lambda x: x.view(B, 1, 1).expand(B, HAND, 4)
    f = torch.stack([
        torch.zeros(B, HAND, 4, device=dev), gap, gap / span.view(B, 1, 1), back10.float(), skipped.float(), stranded.float(), fits_after.float(),
        torch.where(valid, regret_pile, torch.zeros_like(gap)), torch.where(valid, regret_all, torch.zeros_like(gap)), room, asc.float().expand(B, HAND, 4),
        ctx(needed), ctx(g[:, 7]), ctx(g[:, 6] / span), ctx((hand > 0).sum(1).float()), ctx(g[:, 0]), ctx(g[:, 9]), ctx(n_cand),
        react_here, ctx(react.max(-1).values.max(-1).values), ctx(torch.where(best_gap < 1e3, best_gap, torch.zeros_like(best_gap))),
    ], -1).reshape(B, HAND * 4, K)
    end = torch.zeros(B, 1, K, device=dev)
    end[:, 0, 0] = 1
    for name, col in (('needed', needed), ('playedThisTurn', g[:, 7]), ('drawFrac', g[:, 6] / span), ('handCount', (hand > 0).sum(1).float()), ('players', g[:, 0]),
                      ('solitaire', g[:, 9]), ('nCandidates', n_cand), ('bestGap', torch.where(best_gap < 1e3, best_gap, torch.zeros_like(best_gap)))):
        end[:, 0, NAMES.index(name)] = col
    end[:, 0, NAMES.index('gap')] = torch.where(best_gap < 1e3, best_gap, torch.zeros_like(best_gap))
    end[:, 0, NAMES.index('gapFrac')] = end[:, 0, NAMES.index('gap')] / span
    return torch.cat([f, end], 1), mask


class Student:
    """A decision tree over candidate rows. Its action at a position is the legal candidate with the highest predicted chance of being the network's pick."""
    def __init__(self, depth, leaf):
        self.tree = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=leaf)
        self.fitted = False

    def fit(self, X, y, w):
        self.tree.fit(X, y, sample_weight=w)
        self.fitted = True

    def act(self, rec, dev):
        b = ft.to_tensors(rec, dev)
        X, mask = candidates(b)
        B = X.shape[0]
        p = self.tree.predict_proba(X.reshape(B * 45, K).cpu().numpy())[:, 1].reshape(B, 45) if self.fitted else np.random.random((B, 45))
        p = np.where(mask.cpu().numpy() > 0.5, p + 1e-6 * np.random.random((B, 45)), -1)
        return p.argmax(1)


def rows(rec, teacher, dev):
    """Candidate rows for a batch of positions, labelled by the teacher: (X [n,K], y [n], position weights [n])."""
    b = ft.to_tensors(rec, dev)
    X, mask = candidates(b)
    with torch.no_grad():
        card, pair, pile, glob, record, _ = ft.build(b)
        logits = teacher(card, pair, pile, glob, record, b['mask'])
        lp = torch.log_softmax(logits, 1)
        pick = logits.argmax(1)
        top2 = lp.topk(2, 1).values
        weight = (top2[:, 0] - top2[:, 1]).clamp(max=5) + 0.05   # a position where the network is torn between two moves teaches little
    B = X.shape[0]
    y = torch.zeros(B, 45)
    y[torch.arange(B), pick.cpu()] = 1
    m = mask.cpu() > 0.5
    n_legal = m.sum(1)
    keep = m.flatten()
    Xf = X.cpu().reshape(B * 45, K)[keep].numpy()
    yf = y.reshape(-1)[keep].numpy()
    wf = np.repeat(weight.cpu().numpy(), n_legal.numpy())
    return Xf, yf, wf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('checkpoint'); ap.add_argument('--tables', default='s3-solo-99-h7,s3-2p-99-h7,s3-4p-99-h7')
    ap.add_argument('--depth', type=int, default=8); ap.add_argument('--leaf', type=int, default=200)
    ap.add_argument('--rounds', type=int, default=3); ap.add_argument('--states', type=int, default=60000)
    ap.add_argument('--eval-games', type=int, default=1000)
    args = ap.parse_args()
    dev = tr.device()
    ck = torch.load(args.checkpoint, map_location=dev)
    tier_b = ck['args']['tier'] == 'B'; reactions = ck['args'].get('reactions', False)
    teacher = Policy(ck['args'].get('width', 64)).to(dev); teacher.load_state_dict(ck['policy']); teacher.eval()
    tables = args.tables.split(',')
    student = Student(args.depth, args.leaf)
    X, Y, W = [], [], []
    for rnd in range(args.rounds):
        # positions come from the teacher in round 0 and from the student after that
        actors = Actors(tr.ENGINE, tables, 512, 4, 'train', record=tier_b, reactions=reactions)
        got = 0
        while got < args.states:
            rec = actors.current
            x, y, w = rows(rec, teacher, dev)
            X.append(x); Y.append(y); W.append(w)
            got += len(rec)
            actors.step(tr.act(teacher, rec, dev, greedy=True) if rnd == 0 else student.act(rec, dev))
        actors.close()
        student.fit(np.concatenate(X), np.concatenate(Y), np.concatenate(W))
        print(f'round {rnd}: {sum(len(a) for a in X)} candidate rows, tree has {student.tree.get_n_leaves()} leaves', flush=True)
        for t in tables:
            s, w_, l = tr.evaluate(None, t, args.eval_games, tier_b, reactions, dev, act_fn=lambda rec: student.act(rec, dev))
            print(f'  student on {t}: score {s.mean():.2f} won {w_.mean() * 100:.1f}% cards left {l.mean():.2f}', flush=True)
    imp = sorted(zip(NAMES, student.tree.feature_importances_), key=lambda x: -x[1])
    print('feature importance:', ', '.join(f'{n} {v:.2f}' for n, v in imp if v > 0.01))
    import pickle
    out = os.path.join(os.path.dirname(args.checkpoint), f'student-d{args.depth}.pkl')
    pickle.dump(student.tree, open(out, 'wb'))


if __name__ == '__main__':
    main()
