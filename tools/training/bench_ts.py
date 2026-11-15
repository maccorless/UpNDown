"""Speed with TypeScript actors: node processes play the games, this process runs the policy and answers over pipes."""
import subprocess, sys, time
import numpy as np, torch

# argv: path to packages/engine/tools/actor-spike.ts, table id, games per worker, workers, engine directory
ACTOR = sys.argv[1]; TABLE = sys.argv[2]; E = int(sys.argv[3]); WORKERS = int(sys.argv[4]); SECONDS = 8.0
H = 11; F = 2 * H + 12; A = H * 4 + 1
net = torch.nn.Sequential(torch.nn.Linear(34, 256), torch.nn.ReLU(), torch.nn.Linear(256, 256), torch.nn.ReLU(), torch.nn.Linear(256, 45)).to('mps')
procs = [subprocess.Popen(['npx', 'tsx', ACTOR, TABLE, str(E)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=sys.argv[5]) for _ in range(WORKERS)]
def read(p):
    need = E * F * 4 + E * A; buf = bytearray()
    while len(buf) < need:
        chunk = p.stdout.read(need - len(buf))
        if not chunk: raise SystemExit('actor ended')
        buf += chunk
    obs = np.frombuffer(buf, dtype=np.float32, count=E * F).reshape(E, F)
    mask = np.frombuffer(buf, dtype=np.uint8, offset=E * F * 4).reshape(E, A).astype(bool)
    return obs, mask
@torch.no_grad()
def policy(obs, mask):
    logits = net(torch.from_numpy(obs.copy()).to('mps')).masked_fill(~torch.from_numpy(mask).to('mps'), -1e9)
    g = -torch.log(-torch.log(torch.rand_like(logits).clamp_min(1e-9)))
    return (logits + g).argmax(1).cpu().numpy().astype(np.int16)
for p in procs: read_first = None
first = [read(p) for p in procs]
steps = 0; t0 = None; rounds = 0
cur = first
while True:
    for p, (obs, mask) in zip(procs, cur):
        p.stdin.write(policy(obs, mask).tobytes()); p.stdin.flush()
    cur = [read(p) for p in procs]
    rounds += 1
    if rounds == 5: t0 = time.time(); steps = 0
    if t0: steps += E * WORKERS
    if t0 and time.time() - t0 > SECONDS: break
print(f'{TABLE} E={E} workers={WORKERS}: {steps / (time.time() - t0):,.0f} steps/s end to end (TypeScript actors, MLP on mps)')
for p in procs: p.kill()
