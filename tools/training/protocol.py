"""The record format the TypeScript actor writes (packages/engine/tools/actor.ts), and a launcher for actor processes.

Keep this in step with the constants at the top of actor.ts; test_protocol.py checks it against a real actor.
"""
import subprocess
import numpy as np

HAND, OTHERS, DECK = 11, 5, 100
ACTIONS = HAND * 4 + 1
END = HAND * 4
GLOBALS = ['players', 'handSize', 'lo', 'hi', 'perTurn', 'refill', 'drawCount', 'playedThisTurn', 'required', 'solitaire', 'tierB', 'reactionsOn']

RECORD = np.dtype([
    ('seed', '<i4'), ('outcome', 'u1'), ('left', '<i2'), ('draw', '<i2'), ('table', 'u1'), ('reward', '<f4'), ('done', 'u1'),
    ('hand', 'i1', (HAND,)), ('tops', 'i1', (4,)), ('globals', 'i1', (len(GLOBALS),)), ('others', 'i1', (OTHERS,)),
    ('react', 'i1', (OTHERS, 4)), ('seatKind', 'i1', (OTHERS,)), ('played', 'i1', (DECK,)), ('otherHands', 'i1', (OTHERS, HAND)), ('drawSet', 'i1', (DECK,)),
    ('mask', 'u1', (ACTIONS,)),
])


class Actors:
    """Several actor processes, each playing `games` games in lockstep. step(actions) answers every game and returns the next records."""

    def __init__(self, engine_dir, tables, games, workers, set_='train', record=False, reactions=False, lag=0, seat_mix=None, sender=None, pair_rule=False):
        self.games, self.workers = games, workers
        self.procs = []
        for w in range(workers):
            cmd = ['npx', 'tsx', 'tools/actor.ts', '--tables', ','.join(tables), '--games', str(games), '--set', set_,
                   '--worker', str(w), '--workers', str(workers)]
            if record:
                cmd.append('--record')
            if reactions:
                cmd.append('--reactions')
            if lag:
                cmd += ['--lag', str(lag)]
            if sender:
                cmd += ['--sender', sender]
            if pair_rule:
                cmd.append('--pair-rule')
            if seat_mix is not None:
                cmd += ['--seat-mix', str(seat_mix)]
            self.procs.append(subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=engine_dir))
        self.current = self._read_all()

    def _read(self, p):
        need = self.games * RECORD.itemsize
        buf = bytearray()
        while len(buf) < need:
            chunk = p.stdout.read(need - len(buf))
            if not chunk:
                raise RuntimeError('an actor ended')
            buf += chunk
        return np.frombuffer(buf, dtype=RECORD, count=self.games)

    def _read_all(self):
        return np.concatenate([self._read(p) for p in self.procs])

    def step(self, actions):
        """actions: int array of length games * workers, in the order of `current`. Returns the new records."""
        a = np.asarray(actions, dtype='<i2')
        for i, p in enumerate(self.procs):
            p.stdin.write(a[i * self.games:(i + 1) * self.games].tobytes())
            p.stdin.flush()
        self.current = self._read_all()
        return self.current

    def close(self):
        for p in self.procs:
            p.kill()
