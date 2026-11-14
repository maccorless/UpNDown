import { describe, expect, it } from 'vitest';
import { PRESIDENT_FIRST_NAMES, PRESIDENT_LAST_NAMES, cleanPlayerName, randomPresidentName, shortPlayerName, storedSettingsSchema } from '../src/index.js';

describe('president name lists', () => {
  it('have no duplicates and every mash-up fits the 32 character player name rule', () => {
    expect(new Set(PRESIDENT_FIRST_NAMES).size).toBe(PRESIDENT_FIRST_NAMES.length);
    expect(new Set(PRESIDENT_LAST_NAMES).size).toBe(PRESIDENT_LAST_NAMES.length);
    const longest = Math.max(...PRESIDENT_FIRST_NAMES.map((n) => n.length)) + 1 + Math.max(...PRESIDENT_LAST_NAMES.map((n) => n.length));
    expect(longest).toBeLessThanOrEqual(32);
  });
});

describe('randomPresidentName', () => {
  it('joins a first and a last name, from both ends of both lists', () => {
    expect(randomPresidentName(() => 0)).toBe('George Washington');
    expect(randomPresidentName(() => 0.999999)).toBe('Joseph Biden');
  });

  it('can reach every first name and every last name', () => {
    const firsts = new Set<string>();
    const lasts = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const sequence = [i / 2000, ((i * 7) % 2000) / 2000];
      const name = randomPresidentName(() => sequence.shift() as number);
      const space = name.indexOf(' ');
      firsts.add(name.slice(0, space));
      lasts.add(name.slice(space + 1));
    }
    expect(firsts.size).toBe(PRESIDENT_FIRST_NAMES.length);
    expect(lasts.size).toBe(PRESIDENT_LAST_NAMES.length);
  });
});

// The server stores the short form in the game so every screen shows it, and compares names in that form.
describe('shortPlayerName', () => {
  it('shortens a president mash-up to first name and last initial', () => {
    expect(shortPlayerName('Donald Washington')).toBe('Donald W');
    expect(shortPlayerName('Woodrow Van Buren')).toBe('Woodrow V');
  });

  it('never cuts a name somebody typed', () => {
    for (const typed of ['Ken', 'Mary Ann', 'Donald Smith', 'Ken Corless', 'donald washington', 'Donald  Washington', '']) {
      expect(shortPlayerName(typed)).toBe(typed);
    }
  });

  it('makes different people look the same, which is why the server compares the short form', () => {
    expect(shortPlayerName('Donald Washington')).toBe(shortPlayerName('Donald Wilson'));
  });
});

// A name is shown to every other player. Bidi overrides can make "Abraham" display as something else.
describe('cleanPlayerName', () => {
  it('strips control and bidirectional characters, trims, and caps at 32', () => {
    expect(cleanPlayerName('  Abe‮ham\u0007 ')).toBe('Abeham');
    expect(cleanPlayerName('⁦x⁩')).toBe('x');
    expect(cleanPlayerName('a'.repeat(40))).toHaveLength(32);
    expect(cleanPlayerName('‮\u0000')).toBe('');
  });
});

describe('storedSettingsSchema', () => {
  it('accepts a partial document and drops unknown keys', () => {
    expect(storedSettingsSchema.parse({ playerName: ' Harry ', evil: 1 })).toEqual({ playerName: 'Harry' });
    expect(storedSettingsSchema.parse({})).toEqual({});
    expect(storedSettingsSchema.parse({ enableSounds: false })).toEqual({ enableSounds: false });
  });

  it('rejects a name that is empty after cleaning, and invalid nested settings', () => {
    expect(storedSettingsSchema.safeParse({ playerName: '‮  ' }).success).toBe(false);
    expect(storedSettingsSchema.safeParse({ enableSounds: 'yes' }).success).toBe(false);
    expect(storedSettingsSchema.safeParse({ solitaire: { minCardValue: 1 } }).success).toBe(false);
  });
});
