/**
 * Process-local token bucket for GHL v2.
 *
 * GHL's documented limits are 100 req / 10s per token with a small burst.
 * We target a conservative steady state: 8 req/sec, max 4 in-flight.
 * Per-bucket back-pressure: if a 429 lands the bucket pauses briefly so
 * the next request doesn't immediately re-trigger.
 */

// GHL's documented limit is 100 req/10s but in practice /opportunities/search
// throttles harder. 5 req/s steady, max 2 in-flight keeps us well under.
const RATE_PER_SECOND = 5;
const MAX_IN_FLIGHT = 2;
const REFILL_INTERVAL_MS = 1000 / RATE_PER_SECOND;
const MIN_PAUSE_ON_429_MS = 10_000; // full GHL 10s window

let tokens = RATE_PER_SECOND;
let lastRefill = Date.now();
let inFlight = 0;
let pauseUntil = 0;
const waiters: Array<() => void> = [];

function refill() {
  const now = Date.now();
  const dt = now - lastRefill;
  if (dt <= 0) return;
  const add = Math.floor(dt / REFILL_INTERVAL_MS);
  if (add > 0) {
    tokens = Math.min(RATE_PER_SECOND, tokens + add);
    lastRefill = now;
  }
}

function tryWake() {
  while (waiters.length > 0) {
    refill();
    if (Date.now() < pauseUntil) return;
    if (tokens <= 0 || inFlight >= MAX_IN_FLIGHT) return;
    tokens--;
    inFlight++;
    const next = waiters.shift();
    if (next) next();
  }
}

export async function acquire(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    tryWake();
    if (waiters.includes(resolve)) {
      // schedule a refill probe so we eventually wake even if no other
      // requests come in to drive tryWake()
      setTimeout(tryWake, REFILL_INTERVAL_MS).unref?.();
    }
  });
}

export function release() {
  inFlight = Math.max(0, inFlight - 1);
  tryWake();
}

/**
 * Called when a 429 lands: pause the whole bucket so concurrent requests
 * don't immediately re-trigger the limit. We pause for at least one full
 * GHL window (10s) even if Retry-After is shorter or absent.
 */
export function notify429(retryAfterMs = MIN_PAUSE_ON_429_MS) {
  const wait = Math.max(retryAfterMs, MIN_PAUSE_ON_429_MS);
  pauseUntil = Math.max(pauseUntil, Date.now() + wait);
  tokens = 0; // drain the bucket so refill starts fresh
  setTimeout(tryWake, wait + 50).unref?.();
}
