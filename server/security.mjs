import { isIP } from 'node:net';

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export function bearerToken(headers) {
  const value = headers instanceof Headers ? headers.get('authorization') : headers.authorization;
  if (value === undefined || value === null) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) throw new HttpError(401, 'Invalid session', 'invalid_session');
  return match[1];
}
export const originAllowed = (origin, origins) => typeof origin === 'string' && origins.includes(origin);
/** Limit key for one client address. IPv4 is limited per address. IPv6 is grouped by
 * prefix: a /64 stops rotation inside one subnet, but a site delegated a /56 or /48 still
 * has many /64s, so authentication limits group IPv6 by /56. */
export function addressKey(address, ipv6Prefix = 64) {
  if (typeof address !== 'string') return 'unknown';
  let value = address.trim().split('%')[0];
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) value = value.slice(7);
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return 'unknown';
  const [head, tail] = value.toLowerCase().split('::');
  // An embedded dotted quad is always the low 32 bits, outside any prefix used here.
  const groups = text => text ? text.split(':').flatMap(group => group.includes('.') ? ['0', '0'] : [group]) : [];
  const left = groups(head), right = tail === undefined ? [] : groups(tail);
  const full = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(group => Number.parseInt(group, 16));
  const kept = full.slice(0, Math.ceil(ipv6Prefix / 16));
  if (ipv6Prefix % 16) kept[kept.length - 1] &= 0xffff << (16 - ipv6Prefix % 16) & 0xffff;
  return `${kept.map(group => group.toString(16)).join(':')}::/${ipv6Prefix}`;
}
/** The client address: the one header a trusted edge proxy sets, else the peer socket.
 * A missing or malformed header falls back to the peer (reported through onFallback),
 * so a forged value can only join the shared peer limit, never escape it. */
export function clientAddress(req, trustedHeader, onFallback) {
  if (trustedHeader) {
    const value = req.headers[trustedHeader];
    if (typeof value === 'string' && addressKey(value) !== 'unknown') return value.trim();
    onFallback?.();
  }
  return req.socket?.remoteAddress;
}
/** Bounded fixed-window limiter. A full table evicts its oldest window that is still under
 * the limit, so new clients are admitted but flooding new keys cannot flush out a blocked
 * one; only a table holding nothing but blocked windows refuses newcomers. */
export function createRateLimiter(limit, windowMs = 60000, capacity = 5000) {
  const entries = new Map();
  return key => {
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry || entry.expires <= now) {
      entries.delete(key);
      if (entries.size >= capacity) {
        // Windows share one length and start on insertion, so Map order is expiry order.
        for (const [id, value] of entries) { if (value.expires > now) break; entries.delete(id); }
        if (entries.size >= capacity) {
          let open;
          for (const [id, value] of entries) if (value.count <= limit) { open = id; break; }
          if (open === undefined) return false;
          entries.delete(open);
        }
      }
      entry = { count: 0, expires: now + windowMs }; entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}
