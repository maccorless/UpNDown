"""Speed of the Python port with a policy in the loop: steps per second, all cores used by numba, policy on CPU or MPS."""
import sys, time
import numpy as np
import torch
import upndown_env as env

def run(E, players, top, hand, per_turn, policy, seconds=6.0, H=11):
    rng = np.random.default_rng(1)
    n = top - 1
    refill = players == 1
    solitaire = players == 1
    F = 2 * H + 12
    def fresh():
        decks = np.stack([rng.permutation(np.arange(2, top + 1)) for _ in range(E)]).astype(np.int32)
        hands = np.zeros((E, players, 16), dtype=np.int32)
        tops = np.zeros((E, 4), dtype=np.int32)
        ptr = np.zeros(E, dtype=np.int64); cur = np.zeros(E, dtype=np.int64); played = np.zeros(E, dtype=np.int64); phase = np.zeros(E, dtype=np.int64)
        env.reset(decks, hands, tops, ptr, cur, played, phase, hand, 2, top, per_turn, solitaire)
        return decks, hands, tops, ptr, cur, played, phase
    decks, hands, tops, ptr, cur, played, phase = fresh()
    obs = np.zeros((E, F), dtype=np.float32); mask = np.zeros((E, H * 4 + 1), dtype=np.bool_)
    steps = games = 0
    t0 = time.time()
    while time.time() - t0 < seconds:
        env.legal_and_observe(hands[:, :, :H], tops, ptr, cur, played, phase, decks, per_turn, solitaire, obs, mask)
        playing = phase == env.PLAYING
        if not playing.any():
            games += E; decks, hands, tops, ptr, cur, played, phase = fresh(); continue
        act = policy(obs, mask)
        act = np.where(act == H * 4, env.END_TURN, act).astype(np.int64)
        wrong = env.step(act, decks, hands, tops, ptr, cur, played, phase, hand, per_turn, refill, solitaire)
        assert wrong == 0, wrong
        steps += int(playing.sum())
    dt = time.time() - t0
    return steps / dt

def random_policy(obs, mask):
    r = np.random.random(mask.shape).astype(np.float32)
    r[~mask] = -1
    return r.argmax(1)

def mlp(device, width=256):
    net = torch.nn.Sequential(torch.nn.Linear(34, width), torch.nn.ReLU(), torch.nn.Linear(width, width), torch.nn.ReLU(), torch.nn.Linear(width, 45)).to(device)
    @torch.no_grad()
    def policy(obs, mask):
        x = torch.from_numpy(obs).to(device)
        logits = net(x).masked_fill(~torch.from_numpy(mask).to(device), -1e9)
        g = -torch.log(-torch.log(torch.rand_like(logits).clamp_min(1e-9)))
        out = (logits + g).argmax(1)
        return out.cpu().numpy()
    return policy

if __name__ == '__main__':
    print('torch', torch.__version__, 'threads', torch.get_num_threads(), 'mps', torch.backends.mps.is_available())
    for label, (players, top, hand, pt) in {'solo 99 h7': (1, 99, 7, 1), '4p 99 h7': (4, 99, 7, 2)}.items():
        for E in (1024, 8192):
            print(f'{label} E={E}: random legal {run(E, players, top, hand, pt, random_policy):,.0f}/s', flush=True)
            print(f'{label} E={E}: MLP cpu     {run(E, players, top, hand, pt, mlp("cpu")):,.0f}/s', flush=True)
            if torch.backends.mps.is_available():
                print(f'{label} E={E}: MLP mps     {run(E, players, top, hand, pt, mlp("mps")):,.0f}/s', flush=True)
