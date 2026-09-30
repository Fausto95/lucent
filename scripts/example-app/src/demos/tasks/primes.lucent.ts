// Long-running work off the JavaScript thread: an async Lucent function runs
// on the Lucent thread, reports progress through a JavaScript callback, and
// stops when its AbortSignal aborts.
import { delay, now } from "lucent:core";

const SEGMENT = 1 << 20;

/** How long to compute before letting JavaScript in, in ms. */
const SLICE = 8;

/** The primes up to √limit, by a plain sieve of Eratosthenes. */
function smallPrimes(limit: number): number[] {
  const composite = new Uint8Array(limit + 1);
  const primes: number[] = [];

  for (let n = 2; n <= limit; n++) {
    if (composite[n]) continue;

    primes.push(n);
    for (let m = n * n; m <= limit; m += n) composite[m] = 1;
  }

  return primes;
}

/**
 * Counts the primes below `limit`, one segment of the sieve at a time. It
 * reports each new percent, and every few milliseconds it yields: the
 * Lucent thread holds the Lucent lock while it computes, and the JavaScript
 * thread needs it to receive a callback or abort the signal. The lock is
 * fair, so a waiting JavaScript call goes in before the next turn.
 */
export async function countPrimesAsync(
  limit: number,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<number> {
  const base = smallPrimes(Math.floor(Math.sqrt(limit)));
  const composite = new Uint8Array(SEGMENT);
  let count = 0;
  let reported = -1;
  let sliceStart = now();

  for (let low = 2; low < limit; low += SEGMENT) {
    signal.throwIfAborted();

    const high = Math.min(low + SEGMENT, limit);
    composite.fill(0);

    for (const p of base) {
      if (p * p >= high) break;

      let m = Math.max(p * p, Math.ceil(low / p) * p);
      for (; m < high; m += p) composite[m - low] = 1;
    }

    for (let n = low; n < high; n++) if (!composite[n - low]) count++;

    const done = (high - 2) / (limit - 2);
    if (Math.floor(done * 100) !== reported) {
      reported = Math.floor(done * 100);
      onProgress(done);
    }

    if (now() - sliceStart > SLICE) {
      await delay(0);
      sliceStart = now();
    }
  }

  return count;
}
