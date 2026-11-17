import type { Request } from 'express';
import { resolveClientIp } from '../client-ip.js';

export function clientIpOfRequest(req: Request, trustedProxyHops: number): string {
  return resolveClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress ?? 'unknown', trustedProxyHops);
}

export function createIpRateLimiter(trustedProxyHops: number, now: () => number = Date.now) {
  const buckets = new Map<string, number[]>();
  const sweep = setInterval(() => {
    const nowMs = now();
    for (const [key, timestamps] of buckets) {
      if (timestamps.length === 0 || nowMs - timestamps[timestamps.length - 1]! >= 10 * 60_000) {
        buckets.delete(key);
      }
    }
  }, 60_000);
  sweep.unref();

  const allowKey = (key: string, limit: number, windowMs: number): boolean => {
    const nowMs = now();
    let timestamps = buckets.get(key) ?? [];
    timestamps = timestamps.filter(t => nowMs - t < windowMs);
    if (timestamps.length >= limit) {
      if (timestamps.length > 0) buckets.set(key, timestamps);
      return false;
    }
    timestamps.push(nowMs);
    buckets.set(key, timestamps);
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
