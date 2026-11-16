"""Search on top of the network for solitaire: the improvement operator of expert iteration, and a measure of how far the network is from what search can find.

For every real position the search deals the hidden cards at random several times (exact in solitaire when the played-card record is known: the draw pile is a
shuffle of the cards not yet drawn), plays each candidate move out to the end with the network, and keeps the network's own move unless another beats it by a margin
of standard errors. Every game runs in the numba port of the rules (checked against the TypeScript engine by parity.py).
"""
import argparse, json, os, time
import numpy as np
import torch
import upndown_env as env
import features as ft
import train as tr
from model import Policy
from protocol import HAND, DECK

H16 = 16


class Table:
    def __init__(self, hand_size=7, lo=2, hi=99, per_turn=2):
        self.hand_size, self.lo, self.hi, self.per_turn = hand_size, lo, hi, per_turn
        self.n = hi - lo + 1


class Batch:
    """E solitaire games in the numba layout."""
    def __init__(self, decks, tb):
        E = len(decks)
        self.tb = tb
        self.decks = np.ascontiguousarray(decks, dtype=np.int32)
        self.hands = np.zeros((E, 1, H16), dtype=np.int32)
        self.tops = np.zeros((E, 4), dtype=np.int32)
        self.ptr = np.zeros(E, dtype=np.int64); self.cur = np.zeros(E, dtype=np.int64)
        self.played = np.zeros(E, dtype=np.int64); self.phase = np.zeros(E, dtype=np.int64)
        env.reset(self.decks, self.hands, self.tops, self.ptr, self.cur, self.played, self.phase, tb.hand_size, tb.lo, tb.hi, tb.per_turn, True)

    def step(self, actions):
        bad = env.step(np.asarray(actions, dtype=np.int64), self.decks, self.hands, self.tops, self.ptr, self.cur, self.played, self.phase, self.tb.hand_size, self.tb.per_turn, True, True)
        assert bad == 0, f'{bad} illegal actions'

    def playing(self):
        return self.phase == env.PLAYING

    def score(self):
        left_hand = (self.hands[:, 0, :] > 0).sum(1)
        draw = self.decks.shape[1] - self.ptr
        return np.where(self.phase == env.WON, 100.0, 91.0 - left_hand - 2.0 * draw)

    def copy_rows(self, idx):
        b = Batch.__new__(Batch)
        b.tb = self.tb
        b.decks, b.hands, b.tops = self.decks[idx].copy(), self.hands[idx].copy(), self.tops[idx].copy()
        b.ptr, b.cur, b.played, b.phase = self.ptr[idx].copy(), self.cur[idx].copy(), self.played[idx].copy(), self.phase[idx].copy()
        return b


def record(b, dev, tier_b, reactions):
    """The network's inputs for each game, built from the numba arrays exactly as the TypeScript actor would write them (checked in test_search_py.py)."""
    E = len(b.ptr)
    hand = torch.from_numpy(b.hands[:, 0, :HAND].astype(np.float32)).to(dev)
    tops = torch.from_numpy(b.tops.astype(np.float32)).to(dev)
    n = b.decks.shape[1]
    draw = torch.from_numpy((n - b.ptr).astype(np.float32)).to(dev)
    tb = b.tb
    g = torch.zeros(E, 12, device=dev)
    g[:, 0] = 1; g[:, 1] = tb.hand_size; g[:, 2] = tb.lo; g[:, 3] = tb.hi; g[:, 4] = tb.per_turn; g[:, 5] = 1
    g[:, 6] = draw; g[:, 7] = torch.from_numpy(b.played.astype(np.float32)).to(dev)
    g[:, 8] = torch.where(draw == 0, torch.ones_like(draw), torch.full_like(draw, tb.per_turn))
    g[:, 9] = 1; g[:, 10] = 1.0 if tier_b else 0.0; g[:, 11] = 1.0 if reactions else 0.0
    # mask: a card in the slot that the pile accepts
    v = hand.view(E, HAND, 1); t = tops.view(E, 1, 4)
    asc = torch.tensor([1, 1, 0, 0], device=dev).view(1, 1, 4).bool()
    valid = torch.where(asc, (v > t) | (v == t - 10), (v < t) | (v == t + 10)) & (v > 0)
    mask = torch.zeros(E, HAND * 4 + 1, device=dev)
    mask[:, :HAND * 4] = valid.flatten(1).float()
    played = torch.zeros(E, DECK, device=dev)
    if tier_b:
        decks = torch.from_numpy(b.decks.astype(np.int64)).to(dev)
        drawn = (torch.arange(n, device=dev).view(1, n) < torch.from_numpy(b.ptr).to(dev).view(E, 1)).float()
        played.scatter_add_(1, decks, drawn)
        played = (played - ft.multi_hot(hand)).clamp(min=0)
        played[:, 0] = 0
    z = lambda *s: torch.zeros(E, *s, device=dev)
    return {'hand': hand, 'tops': tops, 'globals': g, 'others': z(5), 'react': z(5, 4), 'seatKind': z(5), 'played': played, 'otherHands': z(5, HAND), 'drawSet': z(DECK), 'mask': mask}


@torch.no_grad()
def greedy(policy, b, dev, tier_b, reactions):
    r = record(b, dev, tier_b, reactions)
    card, pair, pile, glob, rec_, _ = ft.build(r)
    return policy(card, pair, pile, glob, rec_, r['mask']).argmax(1).cpu().numpy()


def finish(policy, b, dev, tier_b, reactions, cap=130):
    """Play every game in the batch to the end with the network (greedy)."""
    for _ in range(cap):
        live = np.nonzero(b.playing())[0]
        if len(live) == 0:
            break
        sub = b.copy_rows(live)
        act = greedy(policy, sub, dev, tier_b, reactions)
        full = np.zeros(len(b.ptr), dtype=np.int64)
        full[live] = act
        b.step(full)
    return b.score()


def candidates_of(b, g):
    """Legal (slot, pile) moves of game g, one of each pair of equivalent piles."""
    seen, out = set(), []
    for s in range(HAND):
        c = int(b.hands[g, 0, s])
        if c == 0:
            continue
        for p in range(4):
            top = int(b.tops[g, p])
            ok = (c > top or c == top - 10) if p < 2 else (c < top or c == top + 10)
            if not ok:
                continue
            key = (c, p < 2, top)
            if key in seen:
                continue
            seen.add(key); out.append((s, p))
    return out


def play_games(policy, decks, tb, dev, tier_b, reactions, worlds=0, margin=2.0, rng=None, log=None):
    """Play the games to the end; with worlds > 0 every decision is searched."""
    real = Batch(decks, tb)
    rng = rng or np.random.default_rng(0)
    n = decks.shape[1]
    step = 0
    while real.playing().any():
        live = np.nonzero(real.playing())[0]
        sub = real.copy_rows(live)
        own = greedy(policy, sub, dev, tier_b, reactions)
        chosen = own.copy()
        if worlds > 0:
            rows, owner, cand = [], [], []
            for gi, g in enumerate(live):
                cs = candidates_of(real, g)
                if len(cs) < 2:
                    continue
                own_c = (int(own[gi]) // 4, int(own[gi]) % 4)
                # the network's own move first, then the others
                order = sorted(cs, key=lambda c: 0 if c == own_c or (own_c in cs and False) else 1)
                if own_c in order:
                    order.remove(own_c); order.insert(0, own_c)
                for ci, (s, p) in enumerate(order):
                    owner.append((gi, g)); cand.append((s, p, ci))
            if cand:
                C = len(cand)
                gs = np.array([g for _, g in owner])
                W = worlds
                # worlds: one shuffle of the undrawn cards per (game, world), shared by all candidates of the game
                perms = {}
                for g in set(gs.tolist()):
                    rest = real.decks[g, real.ptr[g]:]
                    perms[g] = np.stack([rng.permutation(rest) for _ in range(W)])
                idx = np.repeat(gs, W)
                big = real.copy_rows(idx)
                for k in range(C):
                    g = gs[k]
                    big.decks[k * W:(k + 1) * W, real.ptr[g]:] = perms[g]
                acts = np.repeat(np.array([s * 4 + p for s, p, _ in cand]), W)
                big.step(acts)
                scores = finish(policy, big, dev, tier_b, reactions).reshape(C, W)
                by_game = {}
                for k, (gi, g) in enumerate(owner):
                    by_game.setdefault(gi, []).append(k)
                for gi, ks in by_game.items():
                    base = scores[ks[0]]
                    best_k, best_m = ks[0], base.mean()
                    for k in ks[1:]:
                        if scores[k].mean() > best_m:
                            best_k, best_m = k, scores[k].mean()
                    if best_k != ks[0]:
                        d = scores[best_k] - base
                        se = d.std(ddof=1) / np.sqrt(len(d)) if len(d) > 1 else 0
                        if d.mean() > margin * se:
                            s, p, _ = cand[best_k]
                            chosen[gi] = s * 4 + p
        full = np.zeros(len(real.ptr), dtype=np.int64)
        full[live] = chosen
        real.step(full)
        step += 1
        if log and step % 10 == 0:
            log(f'  decision step {step}, {int(real.playing().sum())} games still playing')
    return real.score(), real.phase == env.WON


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('checkpoint'); ap.add_argument('decks', help='json from `npm run decks`')
    ap.add_argument('--games', type=int, default=64); ap.add_argument('--worlds', type=int, default=0)
    ap.add_argument('--margin', type=float, default=2.0); ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()
    dev = tr.device()
    ck = torch.load(args.checkpoint, map_location=dev)
    tier_b = ck['args']['tier'] == 'B'; reactions = ck['args'].get('reactions', False)
    policy = Policy(ck['args'].get('width', 64)).to(dev); policy.load_state_dict(ck['policy']); policy.eval()
    d = json.load(open(args.decks))
    decks = np.array(d['decks'][:args.games], dtype=np.int32)
    tb = Table()
    t0 = time.time()
    s, won = play_games(policy, decks, tb, dev, tier_b, reactions, args.worlds, args.margin, np.random.default_rng(args.seed), log=lambda m: print(m, flush=True))
    print(f'{d["table"]} {d["set"]} {len(s)} games, worlds {args.worlds}, margin {args.margin}: score {s.mean():.2f} (se {s.std(ddof=1) / np.sqrt(len(s)):.2f}) won {won.mean() * 100:.1f}%  [{time.time() - t0:.0f}s]')
    np.save(os.path.join(os.path.dirname(args.checkpoint), f'search-w{args.worlds}-m{args.margin}-{d["table"]}.npy'), s)


if __name__ == '__main__':
    main()
