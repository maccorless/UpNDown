"""The network must be symmetric under swapping the two ascending piles (and the two descending ones), and illegal actions must stay masked."""
import os
import numpy as np, torch
from protocol import Actors, END
import features as ft
from model import Policy, Critic

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'engine')
actors = Actors(ENGINE, ['s2-4p-79-h7', 's3-solo-99-h7', 's3-2p-99-h7'], 96, 1, 'validation', record=True, reactions=True)
rec = actors.current
actors.close()
b = ft.to_tensors(rec, 'cpu')
torch.manual_seed(0)
pol, cri = Policy(), Critic(1)
card, pair, pile, glob, record, critic = ft.build(b)
cri = Critic(critic.shape[1])
logits = pol(card, pair, pile, glob, record, b['mask'])
assert logits.shape == (96, 45)
assert (logits[b['mask'] < 0.5] <= -1e8).all() and (logits[b['mask'] > 0.5] > -1e8).all(), 'mask not respected'
print('critic input', critic.shape[1], 'policy params', sum(p.numel() for p in pol.parameters()), 'critic params', sum(p.numel() for p in cri.parameters()))

# swap ascending piles 0<->1 and descending 2<->3 in everything the policy sees
def swap(b, perm):
    c = {k: v.clone() for k, v in b.items()}
    c['tops'] = b['tops'][:, perm]
    c['react'] = b['react'][:, :, perm]
    m = b['mask'][:, :44].view(-1, 11, 4)[:, :, perm].reshape(-1, 44)
    c['mask'] = torch.cat([m, b['mask'][:, 44:]], 1)
    return c
perm = [1, 0, 3, 2]
bs = swap(b, perm)
card2, pair2, pile2, glob2, record2, _ = ft.build(bs)
logits2 = pol(card2, pair2, pile2, glob2, record2, bs['mask'])
want = logits[:, :44].view(-1, 11, 4)[:, :, perm].reshape(-1, 44)
err = (logits2[:, :44] - want).abs()[bs['mask'][:, :44] > 0.5].max().item()
print('max difference after swapping pile pairs', err)
assert err < 1e-4
assert (logits2[:, 44] - logits[:, 44]).abs().max() < 1e-4
# no dependence on hand slot order
idx = torch.stack([torch.randperm(11) for _ in range(96)])
bh = {k: v.clone() for k, v in b.items()}
bh['hand'] = torch.gather(b['hand'], 1, idx)
m = b['mask'][:, :44].view(-1, 11, 4)
bh['mask'] = torch.cat([torch.gather(m, 1, idx.unsqueeze(-1).expand(-1, -1, 4)).reshape(-1, 44), b['mask'][:, 44:]], 1)
c3 = ft.build(bh)
logits3 = pol(*c3[:5], bh['mask'])
want3 = torch.gather(logits[:, :44].view(-1, 11, 4), 1, idx.unsqueeze(-1).expand(-1, -1, 4)).reshape(-1, 44)
err3 = (logits3[:, :44] - want3).abs()[bh['mask'][:, :44] > 0.5].max().item()
print('max difference after shuffling the hand', err3)
assert err3 < 1e-4
print('ok')
