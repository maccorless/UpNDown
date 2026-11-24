import { beforeEach, describe, expect, it } from 'vitest';
import { clearSavedSeat, listSavedSeats, readSavedSeat, writeSavedSeat } from './saved-seat.js';

const seat = { seatKey: 'key-1', gameId: 'ABC123', playerId: 'sock-1', rejoinToken: 'tok-1' };
const NOW = 5_000_000;

// What matters: a seat comes back only while it can still be good, and a damaged or stale record never becomes a rejoin attempt.
describe('saved seat', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns what was saved', () => {
    writeSavedSeat(seat, NOW);
    expect(readSavedSeat('key-1', NOW + 1000)).toEqual({ ...seat, savedAtMs: NOW, signedIn: false });
  });

  // A signed-in table is kept for a week of inactivity on the server, so a signed-in player's seat must still be offered on day three.
  it('keeps a signed-in seat for a week, and a guest seat only two hours', () => {
    const day = 24 * 60 * 60 * 1000;
    writeSavedSeat({ ...seat, signedIn: true }, 0);
    expect(readSavedSeat('key-1', 3 * day)).toMatchObject({ signedIn: true });
    expect(readSavedSeat('key-1', 7 * day + 1)).toBeNull();
    writeSavedSeat(seat, 0);
    expect(readSavedSeat('key-1', 3 * day)).toBeNull();
  });

  it('forgets a seat older than two hours, since the server drops an empty game long before that', () => {
    writeSavedSeat(seat, 0);
    expect(readSavedSeat('key-1', 2 * 60 * 60 * 1000 + 1)).toBeNull();
    writeSavedSeat(seat, 0);
    expect(readSavedSeat('key-1', 2 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('ignores a record from the future (a wrong clock must not keep a dead seat alive)', () => {
    writeSavedSeat(seat, NOW + 10 * 60 * 1000);
    expect(readSavedSeat('key-1', NOW)).toBeNull();
  });

  it.each([
    'not json',
    '"text"',
    'null',
    JSON.stringify({ gameId: 'ABC123' }),
    JSON.stringify({ ...seat, savedAtMs: 'soon' }),
    JSON.stringify({ ...seat, rejoinToken: '', savedAtMs: 1 }),
    JSON.stringify({ ...seat, gameId: 'x'.repeat(500), savedAtMs: 1 })
  ])('treats a damaged record as no seat, and removes it: %s', (raw) => {
    window.localStorage.setItem('upndown.seat.key-1', raw);
    expect(readSavedSeat('key-1', 2)).toBeNull();
    expect(window.localStorage.getItem('upndown.seat.key-1')).toBeNull();
  });

  it('clears one seat and leaves the others', () => {
    writeSavedSeat(seat, NOW);
    writeSavedSeat({ ...seat, seatKey: 'key-2', gameId: 'XYZ789' }, NOW);
    clearSavedSeat('key-1');
    expect(listSavedSeats(NOW).map((s) => s.gameId)).toEqual(['XYZ789']);
  });

  // Two tabs, two games: each has its own entry, so neither overwrites the other.
  it('keeps seats in different games apart and lists the newest first', () => {
    writeSavedSeat(seat, NOW - 2000);
    writeSavedSeat({ ...seat, seatKey: 'key-2', gameId: 'XYZ789', playerId: 'sock-2', rejoinToken: 'tok-2' }, NOW - 1000);
    writeSavedSeat({ ...seat, playerId: 'sock-1b', rejoinToken: 'tok-1b' }, NOW);
    expect(listSavedSeats(NOW).map((s) => [s.seatKey, s.playerId])).toEqual([['key-1', 'sock-1b'], ['key-2', 'sock-2']]);
  });

  it('refuses a key that is not a plain id, so a stored name can never be steered', () => {
    expect(readSavedSeat('../x', NOW)).toBeNull();
  });

  it('keeps working when storage throws', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    try {
      expect(readSavedSeat('key-1')).toBeNull();
      expect(listSavedSeats()).toEqual([]);
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});
