import { describe, expect, it } from 'vitest';
import { resolveClientIp } from '../src/client-ip.js';

const PEER = '10.0.0.1';

describe('resolveClientIp', () => {
  it('finds the client the right number of proxies in from the right', () => {
    // client 9.9.9.9 -> proxy A (172.70.1.1) -> proxy B, which is the TCP peer.
    expect(resolveClientIp('9.9.9.9, 172.70.1.1', PEER, 2)).toBe('9.9.9.9');
    expect(resolveClientIp('9.9.9.9', PEER, 1)).toBe('9.9.9.9');
  });

  it('ignores anything a client prepends, because it sits to the left of the client', () => {
    expect(resolveClientIp('6.6.6.6, 9.9.9.9, 172.70.1.1', PEER, 2)).toBe('9.9.9.9');
    expect(resolveClientIp('1.1.1.1, 2.2.2.2, 6.6.6.6, 9.9.9.9', PEER, 1)).toBe('9.9.9.9');
  });

  it('uses the connection itself when no proxy is trusted, whatever the header says', () => {
    expect(resolveClientIp('6.6.6.6', PEER, 0)).toBe(PEER);
    expect(resolveClientIp(undefined, PEER, 0)).toBe(PEER);
  });

  // The case the old code got wrong: fewer proxies spoke than we trust, so the left side is only what the client typed.
  it('falls back to the connection, not the leftmost entry, when the chain is shorter than the proxies we trust', () => {
    expect(resolveClientIp('6.6.6.6', PEER, 5)).toBe(PEER);
    expect(resolveClientIp('6.6.6.6, 7.7.7.7', PEER, 5)).toBe(PEER);
    expect(resolveClientIp(undefined, PEER, 3)).toBe(PEER);
    expect(resolveClientIp('', PEER, 1)).toBe(PEER);
  });

  it('still trusts the leftmost entry when the chain is exactly as long as the proxies we trust', () => {
    expect(resolveClientIp('9.9.9.9, 172.70.1.1', PEER, 2)).toBe('9.9.9.9');
  });

  it('cannot be made to return a different address by rotating the spoofed one', () => {
    const seen = new Set(['6.6.6.1', '6.6.6.2', '6.6.6.3', '6.6.6.4'].map((spoof) => resolveClientIp(spoof, PEER, 5)));
    expect(seen).toEqual(new Set([PEER]));
  });

  it('reads a header that arrives as several lines, and ignores blanks and spaces', () => {
    expect(resolveClientIp(['9.9.9.9', ' 172.70.1.1 '], PEER, 2)).toBe('9.9.9.9');
    expect(resolveClientIp(' 9.9.9.9 ,, 172.70.1.1', PEER, 2)).toBe('9.9.9.9');
  });
});
