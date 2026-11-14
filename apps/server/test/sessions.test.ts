import { describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_CAP_MS, SESSION_TTL_MS, extendedExpiry, hashToken, initialExpiry, newSessionToken, readCookie,
  sanitizeReturnPath, signOAuthState, verifyOAuthState
} from '../src/auth/sessions.js';

const BASE = 'https://upndown.cloud';
const secret = 's'.repeat(40);
const state = { state: 'abc', verifier: 'ver', returnPath: '/?game=ABC123', expiresAtMs: 2_000 };

// An open redirect after login would let an attacker send a freshly signed-in player to a look-alike site.
describe('sanitizeReturnPath', () => {
  it('keeps invite links, which are the reason return exists', () => {
    expect(sanitizeReturnPath('/?game=ABC123', BASE)).toBe('/?game=ABC123');
    expect(sanitizeReturnPath('/how/deep?x=1', BASE)).toBe('/how/deep?x=1');
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash host', '/\\evil.com'],
    ['absolute URL', 'https://evil.com/'],
    ['no leading slash', 'evil.com'],
    ['control character', '/ok\r\nSet-Cookie: x=1'],
    ['dot-segment host', '/.//evil.com'],
    ['not a string', ['/a', '/b']],
    ['empty', ''],
    ['too long', `/${'a'.repeat(3000)}`]
  ])('falls back to / for %s', (_why, raw) => {
    expect(sanitizeReturnPath(raw, BASE)).toBe('/');
  });

  it('never yields anything but a path on the configured host', () => {
    // An encoded backslash stays literal in a path, so the result still lands on our own origin.
    const result = sanitizeReturnPath('/%5Cevil.com', BASE);
    expect(new URL(result, BASE).origin).toBe(BASE);
  });
});

describe('signed OAuth state', () => {
  it('round-trips while fresh', () => {
    expect(verifyOAuthState(secret, signOAuthState(secret, state), 1_000)).toEqual(state);
  });

  it('rejects expiry, a tampered payload, a different secret and junk', () => {
    const cookie = signOAuthState(secret, state);
    expect(verifyOAuthState(secret, cookie, 2_001)).toBeNull();
    const [payload, sig] = cookie.split('.');
    const forged = Buffer.from(JSON.stringify({ ...state, returnPath: '/evil' })).toString('base64url');
    expect(verifyOAuthState(secret, `${forged}.${sig}`, 1_000)).toBeNull();
    expect(verifyOAuthState('o'.repeat(40), cookie, 1_000)).toBeNull();
    expect(verifyOAuthState(secret, `${payload}.${sig}.extra`, 1_000)).toBeNull();
    expect(verifyOAuthState(secret, undefined, 1_000)).toBeNull();
    expect(verifyOAuthState(secret, 'nodot', 1_000)).toBeNull();
  });
});

describe('session lifetime', () => {
  const day = 86_400_000;
  it('starts at 90 days', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    expect(initialExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });

  it('slides another 90 days from use', () => {
    const created = new Date('2030-01-01T00:00:00Z');
    const now = new Date(created.getTime() + 30 * day);
    expect(extendedExpiry(created, now).getTime()).toBe(now.getTime() + SESSION_TTL_MS);
  });

  // Without the cap a session used every few weeks would never expire, so a stolen cookie lives forever.
  it('never slides past a year after creation', () => {
    const created = new Date('2030-01-01T00:00:00Z');
    const now = new Date(created.getTime() + 300 * day);
    expect(extendedExpiry(created, now).getTime()).toBe(created.getTime() + SESSION_ABSOLUTE_CAP_MS);
  });
});

describe('tokens and cookies', () => {
  it('stores a hash that is not the token, and tokens are unique', () => {
    const token = newSessionToken();
    expect(token).not.toBe(newSessionToken());
    expect(hashToken(token).toString('base64url')).not.toBe(token);
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
  });

  it('reads one cookie out of a header and ignores look-alike names', () => {
    expect(readCookie('a=1; upndown_session=tok; b=2', 'upndown_session')).toBe('tok');
    expect(readCookie('x_upndown_session=evil', 'upndown_session')).toBeUndefined();
    expect(readCookie(undefined, 'a')).toBeUndefined();
  });
});
