"""PPO self-play: one policy plays every seat, with a critic that sees the hidden cards (training only), on dense per-play rewards.

  ./sandboxed.sh uv run --offline python train.py --name s1 --stages 'stage1:30e6' --tier B

Stages are `name:steps` separated by commas, or a comma list of table ids joined with `+` (see STAGES). The same network carries on from
one stage to the next. The actors (TypeScript) hold the rules; this file never decides what is legal.
"""
import argparse, json, os, time
import numpy as np
import torch
import features as ft
from model import Policy, Critic
from protocol import Actors, END

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, '..', '..', 'packages', 'engine')
STAGES = {
    'stage1': ['s1-solo-79-h9', 's1-2p-79-h9', 's1-4p-79-h9'],
    'stage2': ['s2-solo-79-h7', 's2-2p-79-h7', 's2-4p-79-h7', 's2-solo-99-h9', 's2-2p-99-h9', 's2-4p-99-h9', 's2-solo-99-h11'],
    'stage3': ['s3-solo-99-h7', 's3-2p-99-h7', 's3-4p-99-h7'],
}
STAGES['mix12'] = STAGES['stage1'] + STAGES['stage2']
STAGES['mix123'] = STAGES['stage1'] + STAGES['stage2'] + STAGES['stage3'] * 3
REWARD_SCALE = 0.1


def sync(dev):
    if dev == 'mps':
        torch.mps.synchronize()


def device():
    return 'mps' if torch.backends.mps.is_available() else 'cpu'


def score_of(r):
    won = r['outcome'] == 1
    return np.where(won, 100.0, 91.0 - (r['left'].astype(np.float32) - r['draw']) - 2.0 * r['draw'])


@torch.no_grad()
def act(policy, rec, dev, greedy=False):
    b = ft.to_tensors(rec, dev)
    card, pair, pile, glob, record, _ = ft.build(b)
    logits = policy(card, pair, pile, glob, record, b['mask'])
    if greedy:
        return logits.argmax(1).cpu().numpy()
    g = -torch.log(-torch.log(torch.rand_like(logits).clamp_min(1e-9)))
    return (logits + g).argmax(1).cpu().numpy()


def evaluate(policy, table, games, tier_b, reactions, dev, set_='validation', workers=4, act_fn=None, lag=0):
    """Greedy play of the first `games` seeds of a seed set on one table. Returns per-seed scores in seed order, and outcomes."""
    per = -(-games // workers)
    actors = Actors(ENGINE, [table], per, workers, set_, record=tier_b, reactions=reactions, lag=lag)
    scores, wins, left = {}, {}, {}
    try:
        while len(scores) < games:
            rec = actors.current
            fin = rec[rec['seed'] >= 0]
            s = score_of(fin)
            for seed, sc, o, l in zip(fin['seed'], s, fin['outcome'], fin['left']):
                if seed < games and seed not in scores:
                    scores[int(seed)], wins[int(seed)], left[int(seed)] = float(sc), bool(o == 1), int(l)
            if len(scores) >= games:
                break
            actors.step(act_fn(rec) if act_fn else act(policy, rec, dev, greedy=True))
    finally:
        actors.close()
    order = sorted(scores)
    return np.array([scores[i] for i in order]), np.array([wins[i] for i in order]), np.array([left[i] for i in order])


def gae(rew, done, val, last_val, lam=0.95):
    T = rew.shape[0]
    adv = torch.zeros_like(rew)
    nxt, running = last_val, torch.zeros_like(last_val)
    for t in reversed(range(T)):
        delta = rew[t] + (1 - done[t]) * nxt - val[t]
        running = delta + (1 - done[t]) * lam * running
        adv[t] = running
        nxt = val[t]
    return adv, adv + val


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', required=True)
    ap.add_argument('--stages', required=True, help="e.g. stage1:20e6,mix12:40e6")
    ap.add_argument('--tier', default='A', choices=['A', 'B'])
    ap.add_argument('--reactions', action='store_true')
    ap.add_argument('--workers', type=int, default=12)
    ap.add_argument('--games', type=int, default=1024)
    ap.add_argument('--horizon', type=int, default=32)
    ap.add_argument('--epochs', type=int, default=3)
    ap.add_argument('--minibatch', type=int, default=16384)
    ap.add_argument('--lr', type=float, default=3e-4)
    ap.add_argument('--ent', type=float, default=0.01)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--resume', default='')
    ap.add_argument('--eval-games', type=int, default=400)
    ap.add_argument('--eval-every', type=float, default=10e6)
    args = ap.parse_args()
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    dev = device()
    tier_b = args.tier == 'B'
    run_dir = os.path.join(HERE, 'runs', args.name)
    os.makedirs(run_dir, exist_ok=True)
    policy = Policy().to(dev)
    probe = ft.build(ft.to_tensors(Actors(ENGINE, ['s1-solo-79-h9'], 4, 1, 'train').current, 'cpu'))  # input size of the critic
    critic = Critic(probe[5].shape[1]).to(dev)
    if args.resume:
        ck = torch.load(args.resume, map_location=dev)
        policy.load_state_dict(ck['policy']); critic.load_state_dict(ck['critic'])
    opt = torch.optim.Adam(list(policy.parameters()) + list(critic.parameters()), lr=args.lr)
    log = open(os.path.join(run_dir, 'log.txt'), 'a')

    def say(msg):
        print(msg, flush=True); log.write(msg + '\n'); log.flush()

    say(f'run {args.name}: {vars(args)}; policy {sum(p.numel() for p in policy.parameters())} parameters, device {dev}')
    total_steps = 0
    next_eval = args.eval_every
    stages = [(s.split(':')[0], float(s.split(':')[1])) for s in args.stages.split(',')]
    for stage, budget in stages:
        tables = STAGES[stage]
        say(f'--- stage {stage}: {tables}, {budget:.0f} steps')
        actors = Actors(ENGINE, tables, args.games, args.workers, 'train', record=tier_b, reactions=args.reactions)
        N = args.games * args.workers
        stage_steps = 0
        t0 = time.time()
        returns_log = {}
        collect_s = update_s = 0.0
        while stage_steps < budget:
            # Collect: features are built once here and kept on the GPU for the update (no rebuilding per minibatch).
            feats = {k: [] for k in ('card', 'pair', 'pile', 'glob', 'record', 'critic', 'mask')}
            acts, logps, vals, rewards, dones = [], [], [], [], []
            t_start = time.perf_counter()
            for _ in range(args.horizon):
                rec = actors.current
                b = ft.to_tensors(rec, dev)
                card, pair, pile, glob, record, critic_in = ft.build(b)
                with torch.no_grad():
                    logits = policy(card, pair, pile, glob, record, b['mask'])
                    g = -torch.log(-torch.log(torch.rand_like(logits).clamp_min(1e-9)))
                    a = (logits + g).argmax(1)
                    logp = torch.log_softmax(logits, 1).gather(1, a[:, None]).squeeze(1)
                    v = critic(critic_in)
                for k, x in zip(feats, (card, pair, pile, glob, record, critic_in, b['mask'])):
                    feats[k].append(x)
                acts.append(a); logps.append(logp); vals.append(v)
                new = actors.step(a.cpu().numpy())
                rewards.append(new['reward'].copy()); dones.append(new['done'].copy())
                fin = new[new['seed'] >= 0]
                for tb, sc in zip(fin['table'], score_of(fin)):
                    returns_log.setdefault(int(tb), []).append(float(sc))
            rec = actors.current
            b = ft.to_tensors(rec, dev)
            *_, critic_in = ft.build(b)
            with torch.no_grad():
                last_v = critic(critic_in)
            sync(dev); t_collected = time.perf_counter()
            rew = torch.from_numpy(np.stack(rewards)).to(dev) * REWARD_SCALE
            done = torch.from_numpy(np.stack(dones).astype(np.float32)).to(dev)
            val, logp_old, act_t = torch.stack(vals), torch.stack(logps), torch.stack(acts)
            adv, ret = gae(rew, done, val, last_v)
            T = args.horizon
            F = {k: torch.cat(v) for k, v in feats.items()}   # time-major, the same order as adv.flatten()
            del feats
            adv_f, ret_f, logp_f, act_f = adv.flatten(), ret.flatten(), logp_old.flatten(), act_t.flatten()
            adv_f = (adv_f - adv_f.mean()) / (adv_f.std() + 1e-8)
            M = T * N
            stats = torch.zeros(4, device=dev)
            for _ in range(args.epochs):
                perm = torch.randperm(M, device=dev)
                for i in range(0, M, args.minibatch):
                    idx = perm[i:i + args.minibatch]
                    logits = policy(F['card'][idx], F['pair'][idx], F['pile'][idx], F['glob'][idx], F['record'][idx], F['mask'][idx])
                    logp_all = torch.log_softmax(logits, 1)
                    logp_new = logp_all.gather(1, act_f[idx][:, None]).squeeze(1)
                    ratio = torch.exp(logp_new - logp_f[idx])
                    pg = -torch.min(ratio * adv_f[idx], torch.clamp(ratio, 0.8, 1.2) * adv_f[idx]).mean()
                    entropy = -(logp_all.exp() * logp_all.clamp_min(-30)).sum(1).mean()
                    vloss = 0.5 * ((critic(F['critic'][idx]) - ret_f[idx]) ** 2).mean()
                    loss = pg + 0.5 * vloss - args.ent * entropy
                    opt.zero_grad(); loss.backward()
                    torch.nn.utils.clip_grad_norm_(list(policy.parameters()) + list(critic.parameters()), 0.5)
                    opt.step()
                    stats += torch.stack([pg.detach(), vloss.detach(), entropy.detach(), torch.ones((), device=dev)])
            del F
            stats = stats.cpu().numpy()
            sync(dev); t_end = time.perf_counter()
            collect_s += t_collected - t_start; update_s += t_end - t_collected
            stage_steps += M; total_steps += M
            if (total_steps // M) % 10 == 0:
                fps = stage_steps / (time.time() - t0)
                means = ' '.join(f'{STAGES_BY_INDEX(tables, k)}:{np.mean(v):.1f}' for k, v in sorted(returns_log.items()) if v)
                say(f'steps {total_steps / 1e6:6.1f}M  {fps / 1e3:5.0f}k/s  pg {stats[0] / stats[3]:+.3f} v {stats[1] / stats[3]:.3f} ent {stats[2] / stats[3]:.2f}  train score {means}  [collect {collect_s:.0f}s update {update_s:.0f}s]')
                returns_log = {}
                collect_s = update_s = 0.0
            if total_steps >= next_eval:
                next_eval += args.eval_every
                report_eval(say, policy, tables, args, tier_b, dev)
                torch.save({'policy': policy.state_dict(), 'critic': critic.state_dict(), 'args': vars(args), 'steps': total_steps}, os.path.join(run_dir, f'ckpt-{stage}-{int(total_steps / 1e6)}M.pt'))
        actors.close()
        torch.save({'policy': policy.state_dict(), 'critic': critic.state_dict(), 'args': vars(args), 'steps': total_steps}, os.path.join(run_dir, f'end-{stage}.pt'))
        report_eval(say, policy, tables, args, tier_b, dev)


def STAGES_BY_INDEX(tables, k):
    return tables[k] if k < len(tables) else str(k)


def report_eval(say, policy, tables, args, tier_b, dev):
    for t in dict.fromkeys(tables):
        s, w, l = evaluate(policy, t, args.eval_games, tier_b, args.reactions, dev)
        say(f'  eval {t:16s} score {s.mean():6.2f} (se {s.std(ddof=1) / np.sqrt(len(s)):.2f})  won {w.mean() * 100:5.1f}%  cards left {l.mean():5.2f}')


if __name__ == '__main__':
    main()
