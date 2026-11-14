import { describe, expect, it } from 'vitest';
import { uniqueInGameName } from '../src/player-names.js';

describe('uniqueInGameName', () => {
  it('keeps a free name exactly as typed, and shortens a president mash-up', () => {
    expect(uniqueInGameName('Ken', [])).toBe('Ken');
    expect(uniqueInGameName('Donald Washington', ['Ken'])).toBe('Donald W');
    expect(uniqueInGameName('Mary Ann', [])).toBe('Mary Ann');
  });

  it('gives the second player -1 and the third -2', () => {
    expect(uniqueInGameName('Abe', ['Abe'])).toBe('Abe-1');
    expect(uniqueInGameName('Abe', ['Abe', 'Abe-1'])).toBe('Abe-2');
    expect(uniqueInGameName('Abe', ['Abe', 'Abe-1', 'Abe-2'])).toBe('Abe-3');
  });

  // Two players on screen both reading "Donald W" would be indistinguishable, so the check is on the short form.
  it('treats different people who show the same short name as a collision', () => {
    expect(uniqueInGameName('Donald Wilson', ['Donald W'])).toBe('Donald W-1');
    expect(uniqueInGameName('Donald Washington', ['Donald W', 'Donald W-1'])).toBe('Donald W-2');
  });

  it('ignores case and surrounding spaces when comparing, but keeps the joiner\'s own spelling', () => {
    expect(uniqueInGameName('  abe ', ['ABE'])).toBe('abe-1');
  });

  it('skips a suffix that someone already typed as their own name', () => {
    expect(uniqueInGameName('Abe', ['Abe', 'Abe-1'])).toBe('Abe-2');
    expect(uniqueInGameName('Abe-1', ['Abe-1'])).toBe('Abe-1-1');
  });

  it('does not collide with a different name that merely starts the same', () => {
    expect(uniqueInGameName('Abe', ['Abel', 'Abe L'])).toBe('Abe');
  });

  it('trims the base so the suffix still fits in 32 characters', () => {
    const long = 'x'.repeat(32);
    const result = uniqueInGameName(long, [long]);
    expect(result).toHaveLength(32);
    expect(result.endsWith('-1')).toBe(true);
    expect(uniqueInGameName(long, [long, result])).toMatch(/-2$/);
  });
});
