import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { pickRobotPause, robotPauseFromEnv } from '../src/robot-pause.js';
import { lobbyWithUsers } from './helpers/rig.js';

describe('the pause before a robot plays', () => {
  it('keeps the old 0.8 to 1.6 second pause with a person, and a short one for robots alone, when nothing is configured', () => {
    const c = robotPauseFromEnv({});
    expect(c).toEqual({ humanMs: 800, jitterMs: 800, robotsOnlyMs: 150 });
    expect(pickRobotPause(c, true, () => 0)).toBe(800);
    expect(pickRobotPause(c, true, () => 0.999999)).toBe(1600);
    expect(pickRobotPause(c, false, () => 0.5)).toBe(150);
  });

  it('is set from the environment, ignores what is not a number from 0 up, and caps a silly value', () => {
    expect(robotPauseFromEnv({ ROBOT_PAUSE_MS: '2000', ROBOT_PAUSE_JITTER_MS: '0', ROBOT_PAUSE_ROBOTS_ONLY_MS: '40' })).toEqual({ humanMs: 2000, jitterMs: 0, robotsOnlyMs: 40 });
    expect(robotPauseFromEnv({ ROBOT_PAUSE_MS: 'soon', ROBOT_PAUSE_JITTER_MS: '-5', ROBOT_PAUSE_ROBOTS_ONLY_MS: '' })).toEqual({ humanMs: 800, jitterMs: 800, robotsOnlyMs: 150 });
    expect(robotPauseFromEnv({ ROBOT_PAUSE_MS: '999999' }).humanMs).toBe(30_000);
    expect(pickRobotPause({ humanMs: 2000, jitterMs: 0, robotsOnlyMs: 40 }, true, () => 0.9)).toBe(2000);
  });

  // The host's choice replaces the whole wait (base and jitter) so that a short choice really is short; with no person there is nobody to wait for.
  it('uses the host\'s choice, plus up to as much again, at a table with a person, and the short pause for robots alone', () => {
    const c = robotPauseFromEnv({});
    expect(pickRobotPause(c, true, () => 0, 100)).toBe(100);
    expect(pickRobotPause(c, true, () => 0.999999, 100)).toBe(200);
    expect(pickRobotPause(c, true, () => 0, 3000)).toBe(3000);
    expect(pickRobotPause(c, true, () => 0.999999, 800)).toBe(1600);
    expect(pickRobotPause(c, false, () => 0.5, 3000)).toBe(150);
    expect(pickRobotPause(c, true, () => 0, undefined)).toBe(800);
  });

  it('is the short pause only at a table with no person in it', () => {
    const l = lobbyWithUsers([{ id: 'h', name: 'Hana' }]);
    expect(l.manager.hasHumanSeat(l.gameId)).toBe(true);
    expect(new GameManager().hasHumanSeat('NOSUCH')).toBe(false);
  });
});
