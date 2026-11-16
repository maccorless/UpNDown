"""Turns raw actor records into network inputs. Pure tensor maths, no learned parts.

Everything a card or pile feature needs is a fraction of the deck, so what is learned on a small deck means the same on a big one.
Piles are in canonical order (0, 1 ascending, 2, 3 descending); nothing here or in the model depends on which pile is which beyond
its kind, so swapping the two ascending piles (or the two descending ones) swaps the network's answers and nothing else.
"""
import torch
import torch.nn.functional as F
from protocol import HAND, OTHERS, DECK

KIND = torch.tensor([1.0, 1.0, 0.0, 0.0])  # ascending piles first
N_CARD, N_PAIR, N_PILE, N_GLOB = 4, 5, 6 + OTHERS, 18 + OTHERS


def to_tensors(rec, device):
    """rec: numpy structured array of actor records -> dict of tensors on `device`."""
    def t(name, dtype=torch.float32):
        return torch.from_numpy(rec[name].copy()).to(device).to(dtype)
    return {k: t(k) for k in ('hand', 'tops', 'globals', 'others', 'react', 'seatKind', 'played', 'otherHands', 'drawSet', 'mask')}


def multi_hot(values):
    """values: [..., n] card values (0 = empty) -> [..., 100] counts, with the empty column cleared."""
    idx = values.long().clamp(0, DECK - 1)
    out = torch.zeros(*values.shape[:-1], DECK, device=values.device)
    out.scatter_add_(-1, idx, torch.ones(idx.shape, device=values.device))
    out[..., 0] = 0
    return out


def build(b):
    """Returns (card [B,11,4], pair [B,11,4,4], pile [B,4,10], glob [B,18], record [B,100], critic [B,~850])."""
    hand, tops, g = b['hand'], b['tops'], b['globals']
    B = hand.shape[0]
    dev = hand.device
    lo, hi = g[:, 2], g[:, 3]
    span = (hi - lo + 1).clamp(min=1)
    hs = g[:, 1].clamp(min=1)
    present = (hand > 0).float()
    kind = KIND.to(dev).view(1, 1, 4)
    v = hand.view(B, HAND, 1)
    t = tops.view(B, 1, 4)
    valid = b['mask'][:, :HAND * 4].view(B, HAND, 4)
    back10 = torch.where(kind > 0.5, v == t - 10, v == t + 10).float() * present.view(B, HAND, 1)
    gap_raw = torch.where(kind > 0.5, v - t, t - v)
    gap = torch.where(valid > 0.5, torch.where(back10 > 0.5, torch.zeros_like(gap_raw), gap_raw.abs()), torch.zeros_like(gap_raw)) / span.view(B, 1, 1)
    # cards in the hand this play would jump over on that pile (they could no longer go there, except as a backward 10)
    w = hand.view(B, 1, 1, HAND)
    wp = present.view(B, 1, 1, HAND)
    vv, tt = v.view(B, HAND, 1, 1), t.view(B, 1, 4, 1)
    k4 = kind.view(1, 1, 4, 1)
    between = torch.where(k4 > 0.5, (w > tt) & (w < vv) & (w != vv - 10), (w < tt) & (w > vv) & (w != vv + 10)).float() * wp
    skipped = between.sum(-1) * (1 - back10) / hs.view(B, 1, 1)
    # unseen cards the move jumps over: values between the pile top and the card that are neither in my hand nor (Tier B) already played
    inhand = multi_hot(hand)
    vals = torch.arange(DECK, device=dev).view(1, DECK)
    in_deck = ((vals >= lo.view(B, 1)) & (vals <= hi.view(B, 1))).float()
    unseen = (1 - b['played'] - inhand).clamp(min=0) * in_deck
    cs = unseen.cumsum(1)
    def at(ix):
        return torch.gather(cs, 1, ix.clamp(0, DECK - 1).reshape(B, -1)).reshape(ix.shape)
    vi, ti = hand.long().view(B, HAND, 1).expand(B, HAND, 4), tops.long().view(B, 1, 4).expand(B, HAND, 4)
    unseen_between = torch.where((kind > 0.5).expand(B, HAND, 4), at(vi - 1) - at(ti), at(ti - 1) - at(vi)).clamp(min=0)
    unseen_skipped = unseen_between * valid * (1 - back10) / 10.0
    pair = torch.stack([valid, back10, gap, skipped, unseen_skipped], -1)
    big = torch.ones_like(gap)
    min_gap_card = torch.where(valid > 0.5, gap, big).min(-1).values
    card = torch.stack([present, (hand - lo.view(B, 1)).clamp(min=0) / span.view(B, 1) * present, valid.sum(-1) / 4.0, min_gap_card * present + (1 - present)], -1)
    # piles
    top_progress = torch.where(KIND.to(dev).view(1, 4) > 0.5, tops - (lo.view(B, 1) - 1), (hi.view(B, 1) + 1) - tops) / span.view(B, 1)
    react = b['react']  # [B,5,4]
    react_seat = (react / 3.0).permute(0, 2, 1)  # [B,4,5]
    pile_valid_count = valid.sum(1) / hs.view(B, 1)
    pile_min_gap = torch.where(valid > 0.5, gap, big).min(1).values
    # kind, progress along the pile, strongest reaction, summed reactions, share of the hand that can go here, smallest move here,
    # then each other seat's reaction (from the player's left)
    pile = torch.cat([KIND.to(dev).view(1, 4, 1).expand(B, 4, 1), top_progress.unsqueeze(-1), react_seat.max(-1).values.unsqueeze(-1),
                      react_seat.sum(-1, keepdim=True) / OTHERS, pile_valid_count.unsqueeze(-1), pile_min_gap.unsqueeze(-1), react_seat], -1)
    others = b['others'] / 11.0
    glob = torch.cat([
        g[:, 0:1] / 6, g[:, 1:2] / 11, span.view(B, 1) / 100, g[:, 4:5] / 6, g[:, 5:6], g[:, 6:7] / span.view(B, 1), g[:, 7:8] / 6, g[:, 8:9] / 6,
        g[:, 9:10], g[:, 10:11], g[:, 11:12], present.sum(1, keepdim=True) / 11, others, (b['others'].sum(1, keepdim=True) + present.sum(1, keepdim=True)) / 66.0, b['seatKind'],
    ], -1)
    record = b['played'] * g[:, 10:11]
    own = multi_hot(hand)
    others_hot = torch.stack([multi_hot(b['otherHands'][:, k]) for k in range(OTHERS)], 1).flatten(1)
    critic = torch.cat([glob, pile.flatten(1), own, others_hot, b['drawSet'], record], -1)
    return card, pair, pile, glob, record, critic

