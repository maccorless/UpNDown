// The address a connection really came from, for the in-memory rate limits (nothing stores it).
//
// The chain is X-Forwarded-For plus the TCP peer. Each trusted proxy appends the address it saw, so with N trusted
// proxies the client is N entries from the right, and anything a client prepends sits to its left and is ignored.
//
// If the chain is shorter than that (a host with fewer proxies than we expect, such as the direct platform address, or a
// request that skipped a proxy), nothing on the left can be trusted: it is whatever the client typed. Then the answer is
// the connection itself. That shares one bucket among everyone behind it, which is the safe way to be wrong.
export function resolveClientIp(forwardedFor: string | string[] | undefined, peer: string, trustedProxyHops: number): string {
  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const chain = [...forwarded, peer];
  const index = chain.length - 1 - trustedProxyHops;
  return index >= 0 ? (chain[index] as string) : peer;
}
