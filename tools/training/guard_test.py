"""Does the trained network already avoid a pile a teammate 'really loves' (a backward 10 or a tiny move)? And would forbidding such piles help it?"""
import sys
import numpy as np, torch
import train as tr, features as ft, distill as ds
from model import Policy
from protocol import END

ck = torch.load(sys.argv[1], map_location=tr.device())
dev = tr.device()
net = Policy(ck['args'].get('width', 64)).to(dev); net.load_state_dict(ck['policy']); net.eval()
tier_b = ck['args']['tier'] == 'B'
N = {n: i for i, n in enumerate(ds.NAMES)}
stats = {'plays': 0, 'on_rl_pile': 0, 'offered_alt': 0}

def act(rec, guard):
    b = ft.to_tensors(rec, dev)
    card, pair, pile, glob, record, _ = ft.build(b)
    X, mask = ds.candidates(b)
    with torch.no_grad():
        logits = net(card, pair, pile, glob, record, b['mask'])
    X, mask = X.cpu(), mask.cpu() > 0.5
    L = logits.cpu().clone()
    react = torch.from_numpy(rec['react'].astype(np.float32)).max(1).values        # [B,4] strongest mark per canonical pile
    rl = (react == 3)                                                                # really-love piles
    back = X[:, :44, N['backward10']].reshape(-1, 11, 4) > 0
    bad = (rl.view(-1, 1, 4).expand(-1, 11, -1) & ~back).reshape(-1, 44) & mask[:, :44]
    pick = L.argmax(1)
    if guard:
        others = mask.clone(); others[:, :44] &= ~bad
        has_other = others.any(1)
        L2 = L.masked_fill(~others, -1e9)
        pick = torch.where(has_other, L2.argmax(1), pick)
    else:
        isplay = pick < END
        on_rl = isplay & bad[torch.arange(len(pick)), pick.clamp(max=43)]
        stats['plays'] += int(isplay.sum()); stats['on_rl_pile'] += int(on_rl.sum())
        others = mask.clone(); others[:, :44] &= ~bad
        stats['offered_alt'] += int((on_rl & others.any(1)).sum())
    return pick.numpy()

for table in ('s3-2p-99-h7', 's3-4p-99-h7'):
    for mix in (1.0, 0.5):
        out = []
        for guard in (False, True):
            s, w, l = tr.evaluate(net, table, 1500, tier_b, True, dev, seat_mix=mix, act_fn=lambda rec: act(rec, guard))
            out.append((s.mean(), w.mean()))
        print(f'{table} robot seats {mix}: network {out[0][0]:.2f} ({out[0][1] * 100:.1f}%), with a guard that keeps off really-love piles {out[1][0]:.2f} ({out[1][1] * 100:.1f}%)')
print(f"without the guard, the network made {stats['plays']} plays; {stats['on_rl_pile']} ({stats['on_rl_pile'] / max(1, stats['plays']) * 100:.1f}%) were a forward move onto a pile a teammate really loves, {stats['offered_alt']} of them when another move was available")
