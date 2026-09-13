/**
 * A token bucket, in memory, for the one public write endpoint this app has.
 *
 * PER INSTANCE, and that is the whole caveat. Next runs one of these maps per server process, so two
 * instances behind a load balancer allow twice the configured rate, and a deploy resets every
 * bucket. That is acceptable here and would not be for anything that guards money or credentials:
 * this limit exists so a bored visitor cannot fill the events table from a loop, not to make the
 * numbers tamper-proof. Nothing downstream trusts the counts to be un-gamed; the events that matter
 * are the six a browser cannot send at all.
 *
 * A bucket refills continuously rather than resetting on a window boundary, so a caller who has been
 * quiet for a minute gets their full allowance back and one who is hammering gets a steady trickle,
 * instead of everyone racing for a fresh window on the same second.
 */
export interface TokenBucketOptions {
  /** Most requests allowed in a burst. */
  capacity: number;
  /** Tokens added per second. `capacity / refillPerSecond` is how long a full refill takes. */
  refillPerSecond: number;
  /** Most keys tracked at once. Beyond this the least recently seen are dropped. */
  maxKeys?: number;
  /** Injectable clock, so a test does not have to wait in real time. */
  now?: () => number;
}

export interface TokenBucket {
  /** True when the caller may proceed. False when they are over the limit. */
  take(key: string): boolean;
  size(): number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createTokenBucket({
  capacity,
  refillPerSecond,
  maxKeys = 10_000,
  now = Date.now,
}: TokenBucketOptions): TokenBucket {
  // Insertion-ordered, so the oldest key is the first one `keys().next()` yields. Re-inserting on
  // every hit turns that into a least-recently-seen order, which is what the eviction wants.
  const buckets = new Map<string, Bucket>();

  return {
    take(key: string): boolean {
      const at = now();
      const existing = buckets.get(key);
      const bucket: Bucket = existing ?? { tokens: capacity, updatedAt: at };

      if (existing) {
        const elapsedSeconds = Math.max(0, at - existing.updatedAt) / 1000;
        bucket.tokens = Math.min(capacity, existing.tokens + elapsedSeconds * refillPerSecond);
        bucket.updatedAt = at;
        buckets.delete(key);
      }

      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;

      buckets.set(key, bucket);

      // An unbounded map keyed on client IP is a memory leak with a rude name. Evicting the least
      // recently seen caller only ever grants somebody a fresh allowance, never denies one.
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }

      return allowed;
    },

    size(): number {
      return buckets.size;
    },
  };
}
