import type { ResultRow } from '@upndown/shared-types';
import { config } from './config.js';
import { finished } from './order.js';
import { localParts } from './time.js';

export interface Ctx { tz: string; now: number; signedIn: boolean }
export interface Tracker { step(r: ResultRow): void; value(): number | null }
export type Category = 'playing' | 'winning' | 'backward' | 'table' | 'helpers' | 'time' | 'secret';

export interface Badge {
  id: string;
  name: string;
  blurb: string;
  // Shown instead of the name and blurb while a secret badge is locked.
  hint?: string;
  category: Category;
  secret: boolean;
  // One value is a one-time badge. 'atLeast' badges reach a target at or above it, 'atMost' at or below it.
  targets: readonly number[];
  direction: 'atLeast' | 'atMost';
  track(ctx: Ctx): Tracker;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  playing: 'Playing', winning: 'Winning', backward: 'The backward 10', table: 'The table', helpers: 'Cheats and helpers', time: 'Time and quirks', secret: 'Secrets'
};

const sum = (pick: (r: ResultRow, c: Ctx) => number) => (ctx: Ctx): Tracker => {
  let total = 0;
  return { step: (r) => { total += pick(r, ctx); }, value: () => total };
};
const count = (pred: (r: ResultRow, c: Ctx) => boolean) => sum((r, c) => (pred(r, c) ? 1 : 0));
const highest = (pick: (r: ResultRow, c: Ctx) => number | null) => (ctx: Ctx): Tracker => {
  let best = 0;
  return { step: (r) => { best = Math.max(best, pick(r, ctx) ?? 0); }, value: () => best };
};
// The longest run of consecutive rows for which `keep` is true; any other row ends the run.
const longestRun = (keep: (r: ResultRow) => boolean) => (): Tracker => {
  let run = 0;
  let best = 0;
  return { step: (r) => { run = keep(r) ? run + 1 : 0; best = Math.max(best, run); }, value: () => best };
};

const won = (r: ResultRow): boolean => r.outcome === 'won';
const cheatsUsed = (r: ResultRow): number => r.skips + r.trades + r.lookups + r.hints;
const local = (r: ResultRow, c: Ctx) => localParts(r.endedAtMs, c.tz);
const standard = (r: ResultRow): boolean => `${r.handSize}/${r.minCardsPerTurn}/${r.maxCard}` === config.standardDifficulty;
const palindrome = (s: string): boolean => s === [...s].reverse().join('');
const two = (n: number): string => String(n).padStart(2, '0');

const def = (b: Omit<Badge, 'secret' | 'direction'> & { secret?: boolean; direction?: Badge['direction'] }): Badge => ({ secret: false, direction: 'atLeast', ...b });

export const CATALOG: readonly Badge[] = [
  // Playing
  def({ id: 'first-steps', name: 'First Steps', blurb: 'Finish your first game, win or lose.', category: 'playing', targets: [1], track: count(finished) }),
  def({ id: 'regular', name: 'Regular', blurb: 'Finish games. Showing up counts.', category: 'playing', targets: config.regular, track: count(finished) }),
  def({ id: 'long-haul', name: 'Long Haul', blurb: 'Hours spent at the table.', category: 'playing', targets: config.longHaulMs, track: sum((r) => r.durationMs) }),
  def({ id: 'card-shark', name: 'Card Shark', blurb: 'Cards played, all told.', category: 'playing', targets: config.cardShark, track: sum((r) => r.cardsPlayed) }),
  def({ id: 'frequent-flyer', name: 'Frequent Flyer', blurb: 'The distance your cards have traveled up and down the piles.', category: 'playing', targets: config.frequentFlyer, track: sum((r) => Math.max(0, r.totalMovement)) }),
  def({
    id: 'habit', name: 'Habit', blurb: 'Finish a game on consecutive days.', category: 'playing', targets: config.habitDays,
    track: (ctx) => {
      let last: number | null = null;
      let run = 0;
      let best = 0;
      return {
        step: (r) => {
          // A game dated after now (a wrong clock) cannot start or extend a streak.
          if (!finished(r) || r.endedAtMs > ctx.now) return;
          const day = local(r, ctx).dayNumber;
          if (last === null || day > last + 1) run = 1; else if (day === last + 1) run += 1;
          last = last === null ? day : Math.max(last, day);
          best = Math.max(best, run);
        },
        value: () => best
      };
    }
  }),
  def({ id: 'made-official', name: 'Made It Official', blurb: 'Sign in with Google and keep your profile safe.', category: 'playing', targets: [1], track: (ctx) => ({ step: () => undefined, value: () => (ctx.signedIn ? 1 : 0) }) }),
  // Winning
  def({ id: 'up-and-away', name: 'Up and Away', blurb: 'Win games with your team.', category: 'winning', targets: config.wins, track: count(won) }),
  def({ id: 'hot-streak', name: 'Hot Streak', blurb: 'Win several games in a row.', category: 'winning', targets: config.hotStreak, track: longestRun(won) }),
  def({ id: 'so-close', name: 'So Close', blurb: 'Lose with one to three cards left. The heartbreakers.', category: 'winning', targets: config.soClose, track: count((r) => r.outcome === 'lost' && r.cardsLeft >= 1 && r.cardsLeft <= 3) }),
  def({
    id: 'comeback-kid', name: 'Comeback Kid', blurb: 'Win right after losing three in a row.', category: 'winning', targets: [1],
    track: () => {
      let previous: Array<ResultRow['outcome']> = [];
      let earned = 0;
      return {
        step: (r) => {
          if (won(r) && previous.length === 3 && previous.every((o) => o === 'lost')) earned = 1;
          previous = [...previous, r.outcome].slice(-3);
        },
        value: () => earned
      };
    }
  }),
  def({ id: 'light-packer', name: 'Light Packer', blurb: 'Win with the smallest hand, five cards.', category: 'winning', targets: config.lightPacker, track: count((r) => won(r) && r.handSize === config.lightPackerHand) }),
  def({ id: 'closer', name: 'Closer', blurb: 'Play the card that wins the game.', category: 'winning', targets: [1, 10, 50], track: count((r) => won(r) && r.playedLastCard === true) }),
  // The backward 10
  def({ id: 'rewind', name: 'Rewind', blurb: 'Play backward 10s. Time travel is encouraged.', category: 'backward', targets: config.rewind, track: sum((r) => r.specialPlays) }),
  def({ id: 'time-machine', name: 'Time Machine', blurb: 'Play several backward 10s in a single game.', category: 'backward', targets: config.timeMachine, track: highest((r) => (finished(r) ? r.specialPlays : null)) }),
  // The table
  def({ id: 'solo-act', name: 'Solo Act', blurb: 'Win a game of solitaire.', category: 'table', targets: config.solo, track: count((r) => won(r) && r.mode === 'solitaire') }),
  def({ id: 'duet', name: 'Duet', blurb: 'Win a two-player game.', category: 'table', targets: config.duet, track: count((r) => won(r) && r.mode === 'multiplayer' && r.playerCount === 2) }),
  def({ id: 'full-table', name: 'Full Table', blurb: 'Win with six players at the table.', category: 'table', targets: config.fullTable, track: count((r) => won(r) && r.playerCount === 6) }),
  def({ id: 'machine-learning', name: 'Machine Learning', blurb: 'Win with a robot on your team.', category: 'table', targets: config.machineLearning, track: count((r) => won(r) && (r.robotCount ?? 0) >= 1) }),
  def({ id: 'outnumbered', name: 'Outnumbered', blurb: 'Win with more robots than people at the table.', category: 'table', targets: [1], track: count((r) => won(r) && r.robotCount !== null && r.robotCount > r.playerCount - r.robotCount) }),
  // Cheats and helpers
  def({ id: 'clean-hands', name: 'Clean Hands', blurb: 'Win a game that allowed cheats without using any.', category: 'helpers', targets: config.cleanHands, track: count((r) => won(r) && r.cheatsAllowed && cheatsUsed(r) === 0) }),
  def({ id: 'over-my-shoulder', name: 'Over My Shoulder', blurb: 'Ask for hints. No judgment.', category: 'helpers', targets: config.overMyShoulder, track: sum((r) => r.hints) }),
  def({ id: 'swiss-army-knife', name: 'Swiss Army Knife', blurb: 'Use a skip, a trade, a lookup and a hint in one game.', category: 'helpers', targets: [1], track: count((r) => r.skips >= 1 && r.trades >= 1 && r.lookups >= 1 && r.hints >= 1) }),
  def({ id: 'backseat-driver', name: 'Backseat Driver', blurb: 'Place marks on the piles to steer your team.', category: 'helpers', targets: config.backseatDriver, track: sum((r) => r.marks ?? 0) }),
  def({ id: 'oops', name: 'Oops', blurb: 'Take back plays with undo.', category: 'helpers', targets: config.oops, track: sum((r) => r.undos ?? 0) }),
  def({ id: 'no-take-backs', name: 'No Take-Backs', blurb: 'Win a game where undo was allowed and you never used it.', category: 'helpers', targets: [1], track: count((r) => won(r) && r.undoAllowed && r.undos === 0) }),
  // Time and quirks
  def({ id: 'night-owl', name: 'Night Owl', blurb: 'Finish games between 1 and 4 in the morning.', category: 'time', targets: config.nightOwl, track: count((r, c) => finished(r) && local(r, c).hour >= 1 && local(r, c).hour <= 3) }),
  def({ id: 'early-bird', name: 'Early Bird', blurb: 'Finish games between 5 and 7 in the morning.', category: 'time', targets: config.earlyBird, track: count((r, c) => finished(r) && local(r, c).hour >= 5 && local(r, c).hour <= 6) }),
  def({ id: 'marathon', name: 'Marathon', blurb: 'Win a game that lasts more than an hour.', category: 'time', targets: [1], track: count((r) => won(r) && r.durationMs > config.marathonMs) }),
  def({
    id: 'speedrunner', name: 'Speedrunner', blurb: 'Win fast at the standard settings, with no cheats.', category: 'time', targets: config.speedMs, direction: 'atMost',
    track: () => {
      let best: number | null = null;
      return { step: (r) => { if (won(r) && standard(r) && cheatsUsed(r) === 0) best = best === null ? r.durationMs : Math.min(best, r.durationMs); }, value: () => best };
    }
  }),
  // Secrets
  def({ id: 'mirror-mirror', name: 'Mirror, Mirror', blurb: 'Finish a game at a time that reads the same backward.', hint: 'Watch the clock.', category: 'secret', secret: true, targets: [1], track: count((r, c) => finished(r) && palindrome(`${two(local(r, c).hour)}${two(local(r, c).minute)}`)) }),
  def({ id: 'unlucky-for-some', name: 'Unlucky for Some', blurb: 'Win on Friday the 13th.', hint: 'Mind the calendar.', category: 'secret', secret: true, targets: [1], track: count((r, c) => won(r) && local(r, c).weekday === 5 && local(r, c).dayOfMonth === 13) }),
  def({ id: 'table-flip', name: 'Table Flip', blurb: 'End a game you were deep into, as host.', hint: 'Ending a game takes nerve.', category: 'secret', secret: true, targets: [1], track: count((r) => r.outcome === 'abandoned' && r.mode === 'multiplayer' && r.cardsPlayed >= config.tableFlipCards) }),
  def({ id: 'ten-out-of-ten', name: 'Perfect Ten', blurb: 'Win with exactly ten backward 10s.', hint: 'Count your backward 10s.', category: 'secret', secret: true, targets: [1], track: count((r) => won(r) && r.specialPlays === 10) })
];
