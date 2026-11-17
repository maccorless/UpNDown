import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNetInput, loadNetwork, NET_END, networkLogits, type Action, type Network, type NetworkWeights } from '@upndown/engine';
import type { GameState, ReactionState, ReactionType } from '@upndown/shared-types';

// What robots play with. The trained network (packages/engine/models/robot.json) picks the card and pile, or to end the turn; anything it cannot handle
// is left to the written strategy by the caller. The network is shown the played-card record and the table's reactions, and is told which seats
// are robots (their reactions are exact and instant) and which are people (theirs may be late).
export interface RobotBrain {
  // The network's action for the robot on turn, or null when it should not decide (settings outside what the network was built for, or an error).
  choose(state: GameState, robotId: string, reactions: ReactionState): Action | null;
}

const LEVEL: Record<ReactionType, number> = { like: 1, love: 2, really_love: 3 };

// The input layout holds up to 6 players, a hand of 11 and card values below 100.
export function networkFits(state: GameState): boolean {
  const s = state.settings;
  return state.players.length >= 2 && state.players.length <= 6 && s.handSize <= 11 && s.maxCardValue <= 99 && s.minCardValue >= 1 && !state.isSolitaire;
}

export class NetworkBrain implements RobotBrain {
  constructor(private readonly net: Network) {}

  choose(state: GameState, robotId: string, reactions: ReactionState): Action | null {
    if (!networkFits(state) || state.gamePhase !== 'playing') return null;
    const me = state.players[state.currentPlayerIndex];
    if (!me || me.id !== robotId) return null;
    const input = buildNetInput(state, {
      tierB: this.net.tierB,
      reactionsOn: this.net.reactions,
      reactionsOf: (idx) => {
        const marks = reactions[state.players[idx]!.id];
        return [0, 1, 2, 3].map((pileId) => { const r = marks?.[pileId]; return r ? LEVEL[r] : 0; });
      },
      seatKindOf: (idx) => (state.players[idx]!.robot ? 0 : 1)
    });
    const logits = networkLogits(this.net, input);
    let best = -1;
    for (let a = 0; a < input.mask.length; a += 1) if (input.mask[a] === 1 && (best < 0 || logits[a]! > logits[best]!)) best = a;
    if (best < 0) return null;
    if (best === NET_END) return { type: 'endTurn' };
    const card = me.hand[Math.floor(best / 4)];
    const pileId = input.canon[best % 4];
    if (!card || pileId === undefined) return null;
    return { type: 'play', cardId: card.id, pileId };
  }
}

// Finds the bundled model by walking up from this file, or at ROBOT_MODEL_PATH. Returns null (robots then use the written strategy) when switched
// off with ROBOT_BRAIN=heuristic, when the file is missing, or when it cannot be read.
export function loadRobotBrain(env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = () => undefined): RobotBrain | null {
  if (env['ROBOT_BRAIN'] === 'heuristic') { log('robots use the written strategy (ROBOT_BRAIN=heuristic)'); return null; }
  const candidates: string[] = [];
  if (env['ROBOT_MODEL_PATH']) candidates.push(env['ROBOT_MODEL_PATH']);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) { candidates.push(path.join(dir, 'packages', 'engine', 'models', 'robot.json')); dir = path.dirname(dir); }
  const file = candidates.find((c) => existsSync(c));
  if (!file) { log('robot model not found; robots use the written strategy'); return null; }
  try {
    const weights = JSON.parse(readFileSync(file, 'utf8')) as NetworkWeights;
    const brain = new NetworkBrain(loadNetwork(weights));
    log(`robots use the trained network (${path.basename(file)}, width ${weights.width})`);
    return brain;
  } catch (err) {
    log(`robot model could not be loaded (${err instanceof Error ? err.message : String(err)}); robots use the written strategy`);
    return null;
  }
}
