// How long a robot waits before it plays, so other players (people, and other robots) have a moment to react to the table first. Robots re-mark their own
// piles the instant the table changes, so a table with no person needs only a moment; a person needs a human-feeling pause (the old default: 0.8 to 1.6 seconds).
export interface RobotPause {
  // At a table with a person: this many milliseconds plus a random 0 to jitterMs.
  humanMs: number;
  jitterMs: number;
  // At a table of robots only (a training game): just long enough for another robot to react.
  robotsOnlyMs: number;
}

const MAX_MS = 30_000;
const number = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(MAX_MS, Math.round(n)) : fallback;
};

// ROBOT_PAUSE_MS, ROBOT_PAUSE_JITTER_MS and ROBOT_PAUSE_ROBOTS_ONLY_MS; anything missing or not a number from 0 up keeps its default.
export function robotPauseFromEnv(env: NodeJS.ProcessEnv = process.env): RobotPause {
  return { humanMs: number(env['ROBOT_PAUSE_MS'], 800), jitterMs: number(env['ROBOT_PAUSE_JITTER_MS'], 800), robotsOnlyMs: number(env['ROBOT_PAUSE_ROBOTS_ONLY_MS'], 150) };
}

// hostMs is the host's choice for the table (robotPauseMs in the game settings). With a person at the table it replaces both the base and the jitter, so a choice of 800 is
// the usual 0.8 to 1.6 seconds and a choice of 100 is 0.1 to 0.2. A table of robots alone keeps its short pause whatever the host chose.
export function pickRobotPause(config: RobotPause, personAtTable: boolean, random: () => number = Math.random, hostMs?: number): number {
  if (!personAtTable) return config.robotsOnlyMs;
  if (hostMs !== undefined) return hostMs + Math.floor(random() * (hostMs + 1));
  return config.humanMs + Math.floor(random() * (config.jitterMs + 1));
}
