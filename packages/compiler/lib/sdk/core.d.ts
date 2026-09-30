/**
 * Helpers available to Lucent modules. Each one has a native implementation
 * in the Lucent runtime and a JavaScript implementation (the e2e harness's
 * core.js) so the same source also runs as plain TypeScript.
 */

/** Resolves after `ms` milliseconds; rejects with the signal's reason if it aborts first. */
export declare function delay(ms: number, signal?: AbortSignal): Promise<void>;

/** An Error with a machine-readable `code`, visible to JavaScript as `error.code`. */
export declare function error(code: string, message: string): Error;

/** The `code` of an error created with `error()`, or undefined. */
export declare function errorCode(e: Error): string | undefined;

/** UTF-8 encoding of a string (like `new TextEncoder().encode(s)`). */
export declare function utf8Encode(s: string): Uint8Array;

/** Decodes UTF-8 bytes (like `new TextDecoder().decode(b)`), replacing invalid sequences. */
export declare function utf8Decode(bytes: Uint8Array): string;

/** Milliseconds from a monotonic clock, for measuring durations. */
export declare function now(): number;

/**
 * A promise of what a callback API reports once, such as a native listener.
 * `register` starts listening, at once, and may return the cleanup that
 * stops it:
 *
 * ```ts
 * fromCallback<string>((resolve, reject) => {
 *   const subscription = source.listen(resolve, reject);
 *   return () => subscription.cancel();
 * }, signal);
 * ```
 *
 * The first of `resolve`, `reject` and the signal aborting settles the
 * promise; later calls do nothing. The cleanup runs exactly once, as soon as
 * the promise settles, or right after `register` returns if it settled
 * during registration. A throw from `register` rejects the promise. With an
 * aborted signal, the promise rejects with the signal's reason and
 * `register` is not called. A cleanup that throws is reported as uncaught;
 * the promise keeps its outcome. `resolve` takes a value, not a promise.
 *
 * Called from another thread (a `main` block, say), `resolve` and `reject`
 * take effect on the thread `fromCallback` was called on, in the order
 * they were called.
 */
export declare function fromCallback<T>(
  register: (resolve: (value: T) => void, reject: (reason: Error) => void) => (() => void) | void,
  signal?: AbortSignal,
): Promise<T>;

/**
 * Passes what a listener reports to `onValue` until the subscription ends,
 * and resolves when it does. `register` starts listening, at once, and may
 * return the cleanup that stops it.
 *
 * `next(value)` calls `onValue(value)` while the subscription is open, and
 * does nothing after. The first of `end()`, `fail(error)`, `onValue`
 * throwing and the signal aborting ends it: the promise resolves (`end`) or
 * rejects (with the error, or the signal's reason), and the cleanup runs
 * exactly once. Registration, an aborted signal, a throwing cleanup and
 * calls from other threads behave as in `fromCallback`.
 */
export declare function subscribe<T>(
  register: (
    next: (value: T) => void,
    end: () => void,
    fail: (error: Error) => void,
  ) => (() => void) | void,
  onValue: (value: T) => void,
  signal?: AbortSignal,
): Promise<void>;

/** How a compute task runs. */
export interface ComputeOptions {
  /** Aborting it cancels the task: the promise rejects with its reason at once. */
  signal?: AbortSignal;
}

/**
 * Runs `task(input)` on a pool of worker threads and resolves with its
 * result, on the thread that called `compute`. `task` is a function declared
 * at the top level of a module, taking one parameter: the compiler checks
 * everything it runs can run on a worker (no module state, no main-thread
 * or unknown-thread native code, nothing asynchronous) and that `input` and
 * its result are data.
 *
 * `input` is copied when `compute` is called: later changes by the caller
 * do not reach the task. Objects reached twice are copied once, and cycles
 * survive. The result comes back as it is.
 *
 * A task that throws rejects the promise with its error. With `signal`,
 * aborting it rejects the promise at once with the signal's reason: a
 * queued task never starts, and a running one stops at the next iteration
 * of a loop in the task or in a module function it calls. Loops in
 * closures, methods and generic functions, and native calls, run to their
 * end first; the result is then dropped. The pool
 * holds a bounded number of waiting tasks; beyond that, `compute` rejects
 * with a QuotaExceededError.
 *
 * ```ts
 * function edgePositions(bytes: Uint8Array): number[] {
 *   const positions: number[] = [];
 *   for (let i = 1; i < bytes.length; i++)
 *     if (Math.abs(bytes[i]! - bytes[i - 1]!) > 40) positions.push(i);
 *   return positions;
 * }
 *
 * export async function edges(bytes: Uint8Array, signal: AbortSignal): Promise<number[]> {
 *   return await compute(edgePositions, bytes, { signal });
 * }
 * ```
 */
export declare function compute<T, R>(
  task: (input: T) => R,
  input: T,
  options?: ComputeOptions,
): Promise<Awaited<R>>;

/**
 * Bytes native code owns, handed to compute tasks and JavaScript without
 * copying them. A `Uint8Array` is copied whenever it crosses; a
 * NativeBuffer moves.
 *
 * The bytes are reached through a borrow, for the length of one call:
 * `withRead` lends them to its callback as a `ByteSpan`, `withWrite` as a
 * `MutableByteSpan`. Reads share the buffer; a write needs it to itself.
 * A borrow that would conflict with one in progress (a write inside a
 * read, a close or transfer inside either) throws an InvalidStateError at
 * once. The compiler keeps a span inside its callback: it cannot be
 * returned, stored, captured by a closure that outlives the call, passed
 * to code that keeps it, or held across `await`.
 *
 * `transfer()` moves the bytes to a new buffer, uncopied: every reference
 * to the old one then refuses them. Passing a buffer to `compute`, alone
 * or inside the input, moves it the same way, and a task's buffer comes
 * back as it is. Copies are explicit: `NativeBuffer.from(bytes)` and
 * `toUint8Array()`, which `NativeBuffer.stats()` counts.
 *
 * ```ts
 * function scan(buffer: NativeBuffer): number {
 *   using owned = buffer;
 *   return owned.withRead((bytes) => {
 *     let total = 0;
 *     for (let i = 0; i < bytes.length; i++) total += bytes[i]!;
 *     return total;
 *   });
 * }
 *
 * export async function sample(): Promise<number> {
 *   const buffer = NativeBuffer.allocate(4096);
 *   buffer.withWrite((bytes) => bytes.fill(7));
 *   return await compute(scan, buffer.transfer());
 * }
 * ```
 *
 * JavaScript sees a buffer as an opaque object with the same methods; its
 * borrows lend it a copy of the bytes (copied back after `withWrite`), so
 * JavaScript never holds memory a worker may be writing.
 */
export declare class NativeBuffer {
  private constructor();

  /** A buffer of `size` zeroed bytes: a RangeError unless `size` is a whole number from 0. */
  static allocate(size: number): NativeBuffer;

  /** A new buffer holding a copy of `bytes`. */
  static from(bytes: Uint8Array): NativeBuffer;

  /** What every buffer has done since the app started. */
  static stats(): NativeBufferStats;

  /** How many bytes it holds: 0 once closed or transferred. */
  readonly byteLength: number;

  /** Calls `read` with the bytes, while no one writes them, and returns what it returns. */
  withRead<R>(read: (bytes: ByteSpan) => R): R;

  /** Calls `write` with the bytes, while nothing else borrows them, and returns what it returns. */
  withWrite<R>(write: (bytes: MutableByteSpan) => R): R;

  /** A copy of the bytes, independent of the buffer from then on. */
  toUint8Array(): Uint8Array;

  /** Moves the bytes, uncopied, to a new buffer: every reference to this one refuses them from now on. */
  transfer(): NativeBuffer;

  /** Releases the bytes. Closing a closed or transferred buffer does nothing. */
  close(): void;

  [Symbol.dispose](): void;
}

/** The bytes `withRead` lends, read like a `Uint8Array`'s: `bytes[i]` is undefined out of range. */
export interface ByteSpan {
  readonly length: number;
  readonly [index: number]: number;
}

/** The bytes `withWrite` lends, written like a `Uint8Array`'s: values wrap to 0–255, writes out of range do nothing. */
export interface MutableByteSpan extends ByteSpan {
  [index: number]: number;

  /** Sets the bytes from `start` to `end` (counted from the end when negative) to `value`. */
  fill(value: number, start?: number, end?: number): void;

  /** Copies `source` in at `offset`: a RangeError if it does not fit. */
  set(source: Uint8Array, offset?: number): void;
}

/** Counts of what native buffers have done, for checking that a path does not copy. */
export interface NativeBufferStats {
  /** Buffers allocated, including those `from` made. */
  readonly allocated: number;
  /** Buffers native code handed over with its own memory. */
  readonly adopted: number;
  /** Moves of a buffer's bytes to a new buffer: `transfer()` and handoffs to tasks. */
  readonly transfers: number;
  /** Copies in and out (`from`, `toUint8Array`, and JavaScript's borrows), and their bytes. */
  readonly copies: number;
  readonly bytesCopied: number;
}
