import { beforeEach, describe, expect, it } from 'vitest';
import { clearSavedSeat, readSavedSeat, writeSavedSeat } from './saved-seat.js';

const seat = { gameId: 'ABC123', playerId: 'sock-1', rejoinToken: 'tok-1' };

// What matters: a seat comes back only while it can still be good, and a damaged or stale record never becomes a rejoin attempt.
describe('saved seat', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns what was saved', () => {
    writeSavedSeat(seat, 1000);
    expect(readSavedSeat(2000)).toEqual({ ...seat, savedAtMs: 1000 });
  });

  it('forgets a seat older than two hours, since the server drops an empty game long before that', () => {
    writeSavedSeat(seat, 0);
    expect(readSavedSeat(2 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(readSavedSeat(2 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('ignores a record from the future (a wrong clock must not keep a dead seat alive)', () => {
    writeSavedSeat(seat, 10 * 60 * 1000);
    expect(readSavedSeat(0)).toBeNull();
  });

  it.each([
    'not json',
    '"text"',
    'null',
    JSON.stringify({ gameId: 'ABC123' }),
    JSON.stringify({ ...seat, savedAtMs: 'soon' }),
    JSON.stringify({ ...seat, rejoinToken: '', savedAtMs: 1 }),
    JSON.stringify({ ...seat, gameId: 'x'.repeat(500), savedAtMs: 1 })
  ])('treats a damaged record as no seat: %s', (raw) => {
    window.localStorage.setItem('upndown.seat', raw);
    expect(readSavedSeat(2)).toBeNull();
  });

  it('clears', () => {
    writeSavedSeat(seat, 1);
    clearSavedSeat();
    expect(readSavedSeat(2)).toBeNull();
  });

  it('keeps working when storage throws', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    try {
      expect(readSavedSeat()).toBeNull();
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});
