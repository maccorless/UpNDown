const HOUR = 3_600_000;

// Every threshold in one place. Bronze, Silver, Gold in that order; a smaller number is better only where noted.
// After release thresholds only ever go down (a badge a player was shown must stay earned).
export const config = {
  regular: [10, 50, 250],
  longHaulMs: [1 * HOUR, 10 * HOUR, 50 * HOUR],
  cardShark: [100, 1_000, 10_000],
  frequentFlyer: [1_000, 10_000, 100_000],
  habitDays: [3, 7, 30],
  wins: [1, 10, 50],
  hotStreak: [3, 5, 10],
  soClose: [1, 5, 15],
  lightPackerHand: 5,
  lightPacker: [1, 5, 20],
  rewind: [10, 100, 1_000],
  timeMachine: [3, 6, 10],
  // Measured with the strategy: 0.04 lifelines a player a game at four players, 0.2 at normal solitaire, none at Easy.
  // Silver and Gold are a long chase on purpose.
  lifeline: [1, 5, 20],
  // Not measured: the simulator places no human marks. A judgment call, to be checked against real games.
  calledIt: [1, 10, 50],
  solo: [1, 10, 50],
  duet: [1, 10, 50],
  fullTable: [1, 5, 20],
  machineLearning: [1, 10, 50],
  cleanHands: [1, 10, 25],
  overMyShoulder: [10, 50, 200],
  backseatDriver: [50, 250, 1_000],
  oops: [10, 50, 250],
  nightOwl: [1, 10, 50],
  earlyBird: [1, 10, 50],
  marathonMs: 1 * HOUR,
  // Best winning time at the standard settings, in milliseconds: smaller is better. Judgment calls, not measured:
  // the simulator has no human pacing (see docs/plans/2026-11-17-achievement-tuning-report.md).
  speedMs: [10 * 60_000, 7 * 60_000, 5 * 60_000],
  tableFlipCards: 20,
  standardDifficulty: '7/2/99'
} as const;
