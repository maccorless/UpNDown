import type { Request } from 'express';
import { resolveClientIp } from '../client-ip.js';

export function clientIpOfRequest(req: Request, trustedProxyHops: number): string {
  return resolveClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress ?? 'unknown', trustedProxyHops);
}

export function createIpRateLimiter(trustedProxyHops: number, now: () => number = Date.now) {
  const buckets = new Map<string, { windowStartMs: number; count: number }>();
  const sweep = setInterval(() => {
    const nowMs = now();
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.windowStartMs >= 10 * 60_000) buckets.delete(key);
    }
  }, 60_000);
  sweep.unref();

  const allowKey = (key: string, limit: number, windowMs: number): boolean => {
    const nowMs = now();
    const bucket = buckets.get(key);
    if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
      buckets.set(key, { windowStartMs: nowMs, count: 1 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };

  return {
    // True when the request may go ahead.
    allow: (req: Request, name: string, limit: number, windowMs: number): boolean =>
      allowKey(`${name}:ip:${clientIpOfRequest(req, trustedProxyHops)}`, limit, windowMs),
    // Per signed-in user, on top of the per-IP limit: many people can share one address, and one person can change it.
    allowUser: (userId: string, name: string, limit: number, windowMs: number): boolean =>
      allowKey(`${name}:user:${userId}`, limit, windowMs),
    stop: () => clearInterval(sweep)
  };
}
