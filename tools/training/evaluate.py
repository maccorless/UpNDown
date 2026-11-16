"""Plays a checkpoint greedily on a table and compares it with the written strategy on the same deals.

  ./sandboxed.sh uv run --offline python evaluate.py runs/a1/end-stage3.pt s3-4p-99-h7 --games 3000 [--set validation]

The strategy's per-game scores come from `npm run sim -- eval ... --dump file.json` (same seeds). Needs the test set only for the final report:
using --set test is logged to runs/test-set-usage.log.
"""
import argparse, json, os, subprocess, time
import numpy as np
import torch
import train as tr
from model import Policy

ap = argparse.ArgumentParser()
ap.add_argument('checkpoint'); ap.add_argument('table')
ap.add_argument('--games', type=int, default=1000); ap.add_argument('--set', default='validation')
ap.add_argument('--tier', default=None); ap.add_argument('--reactions', action='store_true')
ap.add_argument('--lag', type=int, default=0, help='reactions shown are this many plays old')
ap.add_argument('--against-reactions', action='store_true', help='compare with the strategy using the hand-written receiver')
args = ap.parse_args()
dev = tr.device()
ck = torch.load(args.checkpoint, map_location=dev)
tier_b = (args.tier or ck['args']['tier']) == 'B'
reactions = args.reactions or ck['args'].get('reactions', False)
policy = Policy().to(dev); policy.load_state_dict(ck['policy']); policy.eval()
s, w, l = tr.evaluate(policy, args.table, args.games, tier_b, reactions, dev, args.set, lag=args.lag)
dump = os.path.join(tr.HERE, 'runs', f'strategy-{args.table}-{args.set}-{args.games}{"-r" if args.against_reactions else ""}.json')
if not os.path.exists(dump):
    cmd = ['npm', 'run', '--silent', 'sim', '--', 'eval', '--table', args.table, '--set', args.set, '--games', str(args.games), '--dump', dump] + (['--reactions'] if args.against_reactions else [])
    subprocess.run(cmd, cwd=tr.ENGINE, check=True, stdout=subprocess.DEVNULL)
base = json.load(open(dump))
bs, bw = np.array(base['scores']), np.array(base['won'])
d = s - bs
se = d.std(ddof=1) / np.sqrt(len(d))
print(f'{args.table} ({args.set}, {len(s)} games, Tier {"B" if tier_b else "A"}{", reactions" if reactions else ""}{f", lag {args.lag}" if args.lag else ""})')
print(f'  network:  score {s.mean():.2f}  won {w.mean() * 100:.1f}%  cards left {l.mean():.2f}')
print(f'  strategy: score {bs.mean():.2f}  won {bw.mean() * 100:.1f}%  cards left {np.mean(base["left"]):.2f}')
print(f'  paired:   score {d.mean():+.2f} ({d.mean() - 1.96 * se:+.2f} to {d.mean() + 1.96 * se:+.2f}), only network won {int((w & ~bw).sum())}, only strategy won {int((~w & bw).sum())}')
if args.set == 'test':
    os.makedirs(os.path.join(tr.HERE, 'runs'), exist_ok=True)
    open(os.path.join(tr.HERE, 'runs', 'test-set-usage.log'), 'a').write(f'{time.strftime("%Y-%m-%dT%H:%M:%S")}  {args.checkpoint}  {args.table}  games 0..{len(s) - 1}\n')
