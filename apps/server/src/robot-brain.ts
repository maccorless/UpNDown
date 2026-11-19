import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNetInput, explainMove, loadNetwork, NET_END, networkLogits, type Action, type Explanation, type Network, type NetworkWeights } from '@upndown/engine';
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

// The network's choice for the player on turn, with the scores it came from, or null when it should not decide.
function decide(net: Network, state: GameState, playerId: string, reactions: ReactionState) {
  if (!networkFits(state) || state.gamePhase !== 'playing') return null;
  const me = state.players[state.currentPlayerIndex];
  if (!me || me.id !== playerId) return null;
  const input = buildNetInput(state, {
    tierB: net.tierB,
    reactionsOn: net.reactions,
    pairRule: net.pairRule,
    reactionsOf: (idx) => {
      const marks = reactions[state.players[idx]!.id];
      return [0, 1, 2, 3].map((pileId) => { const r = marks?.[pileId]; return r ? LEVEL[r] : 0; });
    },
    seatKindOf: (idx) => (state.players[idx]!.robot ? 0 : 1)
  });
  const logits = networkLogits(net, input);
  let best = -1;
  for (let a = 0; a < input.mask.length; a += 1) if (input.mask[a] === 1 && (best < 0 || logits[a]! > logits[best]!)) best = a;
  if (best < 0) return null;
  let action: Action;
  if (best === NET_END) action = { type: 'endTurn' };
  else {
    const card = me.hand[Math.floor(best / 4)];
    const pileId = input.canon[best % 4];
    if (!card || pileId === undefined) return null;
    action = { type: 'play', cardId: card.id, pileId };
  }
  return { action, input, logits, best };
}

export class NetworkBrain implements RobotBrain {
  constructor(private readonly net: Network) {}

  choose(state: GameState, robotId: string, reactions: ReactionState): Action | null {
    return decide(this.net, state, robotId, reactions)?.action ?? null;
  }
}

// A hint from the screen-only network, with reasons a player can check. It never uses what the player cannot see: its input has no played-card record,
// only the hand, the piles, the counts and the marks on the table.
export interface HintAdvisor {
  advise(state: GameState, playerId: string, reactions: ReactionState): { action: Action; headline: string; reasons: string[] } | null;
}

export class NetworkAdvisor implements HintAdvisor {
  constructor(private readonly net: Network) {
    if (net.tierB) throw new Error('A hint must not use the played-card record');
  }

  advise(state: GameState, playerId: string, reactions: ReactionState): { action: Action; headline: string; reasons: string[] } | null {
    const d = decide(this.net, state, playerId, reactions);
    if (!d) return null;
    const cur = state.currentPlayerIndex;
    const names = Array.from({ length: Math.max(0, state.players.length - 1) }, (_, k) => state.players[(cur + k + 1) % state.players.length]!.name);
    const why: Explanation = explainMove(d.input, d.best, d.logits, names);
    return { action: d.action, headline: why.headline, reasons: why.reasons };
  }
}

function bundledModel(file: string, env: NodeJS.ProcessEnv, pathVar: string): string | undefined {
  const candidates: string[] = [];
  if (env[pathVar]) candidates.push(env[pathVar]!);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) { candidates.push(path.join(dir, 'packages', 'engine', 'models', file)); dir = path.dirname(dir); }
  return candidates.find((c) => existsSync(c));
}

function loadBundled<T>(file: string, off: string, pathVar: string, what: string, make: (net: Network) => T, env: NodeJS.ProcessEnv, log: (msg: string) => void): T | null {
  if (env[off] === 'heuristic') { log(`${what} use the written strategy (${off}=heuristic)`); return null; }
  const found = bundledModel(file, env, pathVar);
  if (!found) { log(`${what} model not found; the written strategy is used`); return null; }
  try {
    const weights = JSON.parse(readFileSync(found, 'utf8')) as NetworkWeights;
    const made = make(loadNetwork(weights));
    log(`${what} use the trained network (${path.basename(found)}, width ${weights.width})`);
    return made;
  } catch (err) {
    log(`${what} model could not be loaded (${err instanceof Error ? err.message : String(err)}); the written strategy is used`);
    return null;
  }
}

// Robots use packages/engine/models/robot.json (or ROBOT_MODEL_PATH). Null (the written strategy) when switched off with ROBOT_BRAIN=heuristic, or the file is missing or unreadable.
export function loadRobotBrain(env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = () => undefined): RobotBrain | null {
  return loadBundled('robot.json', 'ROBOT_BRAIN', 'ROBOT_MODEL_PATH', 'robots', (net) => new NetworkBrain(net), env, log);
}

// Hints use packages/engine/models/hint.json (or HINT_MODEL_PATH); HINT_BRAIN=heuristic switches it off.
export function loadHintAdvisor(env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = () => undefined): HintAdvisor | null {
  return loadBundled('hint.json', 'HINT_BRAIN', 'HINT_MODEL_PATH', 'hints', (net) => new NetworkAdvisor(net), env, log);
}
