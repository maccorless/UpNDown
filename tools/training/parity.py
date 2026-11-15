"""Replays TypeScript golden traces through the Python port and compares the state after every action."""
import json, sys
import numpy as np
import upndown_env as env

def snapshot(e, hands, tops, ptr, cur, played, phase, n):
    P = hands.shape[1]
    return [int(phase[e]), int(cur[e]), int(played[e]), int(n - ptr[e]), *map(int, tops[e]),
            *[int(np.count_nonzero(hands[e, p])) for p in range(P)], *[int(hands[e, p].sum()) for p in range(P)]]

def main(path):
    games = [json.loads(l) for l in open(path)]
    checked = bad = 0
    for g in games:
        P = g['players']
        deck = np.array([g['deck']], dtype=np.int32)
        hands = np.zeros((1, P, 16), dtype=np.int32)
        tops = np.zeros((1, 4), dtype=np.int32)
        ptr = np.zeros(1, dtype=np.int64); cur = np.zeros(1, dtype=np.int64); played = np.zeros(1, dtype=np.int64); phase = np.zeros(1, dtype=np.int64)
        solitaire = P == 1
        env.reset(deck, hands, tops, ptr, cur, played, phase, g['hand'], g['min'], g['top'], g['perTurn'], solitaire)
        n = deck.shape[1]
        if snapshot(0, hands, tops, ptr, cur, played, phase, n) != g['start']:
            bad += 1; print('start differs', g['table']); continue
        for i, st in enumerate(g['steps']):
            kind, value, pile = st['a']
            if kind == 1:
                action = env.END_TURN
            else:
                slot = int(np.where(hands[0, cur[0]] == value)[0][0])
                action = slot * 4 + pile
            wrong = env.step(np.array([action]), deck, hands, tops, ptr, cur, played, phase, g['hand'], g['perTurn'], g['refill'], solitaire)
            got = snapshot(0, hands, tops, ptr, cur, played, phase, n)
            checked += 1
            if wrong or got != st['after']:
                bad += 1; print('DIFF', g['table'], 'step', i, 'got', got, 'want', st['after']); break
    print(f'{len(games)} games, {checked} steps checked, {bad} games differ')
    return bad

if __name__ == '__main__':
    sys.exit(1 if main(sys.argv[1]) else 0)
