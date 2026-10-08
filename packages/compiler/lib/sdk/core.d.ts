/**
 * lucent:core: helpers every module can import. Each has a native
 * implementation in the Lucent runtime, and a JavaScript one in
 * `@lucent-lang/lucent/core`, so the same source also runs as TypeScript.
 */

/**
 * Runs `hook` when this module's state ends: before a JavaScript reload
 * initializes the module again, or when the app's JavaScript runtime goes,
 * as Expo's `OnDestroy` does. Module state is initialized for each runtime:
 * a module's top-level code is its create hook. Stop there what module
 * code started for this state and that a reload would leave running, such
 * as an SDK observer.
 *
 * Hooks run in a turn of the module's code, the last registered first,
 * while the module's state is still the one ending. What one throws goes
 * to the platform log, and the others run.
 *
 * ```ts
 * import { onDestroy } from "lucent:core";
 *
 * let watching: (() => void) | undefined;
 * const stopWatching = onDestroy(() => watching?.());
 * ```
 *
 * @param hook What to run when the module's state ends.
 * @returns The function that removes the hook first.
 */
export declare function onDestroy(hook: () => void): () => void;

/**
 * Resolves after `ms` milliseconds; rejects with the signal's reason if it aborts first.
 *
 * @param ms How long to wait, in milliseconds.
 * @param signal Rejects the promise early, with its reason.
 */
export declare function delay(ms: number, signal?: AbortSignal): Promise<void>;

/**
 * An Error with a machine-readable `code`, which JavaScript reads as `error.code`.
 *
 * @param code What JavaScript branches on, such as `"E_NOT_FOUND"`.
 * @param message What a person reads.
 */
export declare function error(code: string, message: string): Error;

/**
 * The `code` of an error made with `error()`, or undefined.
 *
 * @param e An error, from `error()` or not.
 */
export declare function errorCode(e: Error): string | undefined;

/**
 * The UTF-8 bytes of a string, like `new TextEncoder().encode(s)`.
 *
 * @param s The string to encode.
 */
export declare function utf8Encode(s: string): Uint8Array;

/**
 * Decodes UTF-8 bytes, like `new TextDecoder().decode(bytes)`, replacing invalid sequences.
 *
 * @param bytes The UTF-8 bytes to decode.
 */
export declare function utf8Decode(bytes: Uint8Array): string;

/** Milliseconds from a monotonic clock, for measuring durations. */
export declare function now(): number;

/**
 * A promise of what a callback API reports once, such as a native listener.
 * `register` starts listening at once, and may return the cleanup that
 * stops it.
 *
 * The first of `resolve`, `reject` and the signal aborting settles the
 * promise, and later calls do nothing. `resolve` takes a value, not a
 * promise: the compiler refuses a promise type.
 *
 * The cleanup runs exactly once, inside the call that settles the promise,
 * before anything awaiting it continues. If the promise settled during
 * registration, it runs right after `register` returns. A cleanup that
 * throws is reported as uncaught, and the promise keeps its outcome.
 *
 * A throw from `register` rejects the promise. With a signal already
 * aborted, the promise rejects with the signal's reason, and `register` is
 * not called.
 *
 * Called from another thread (inside `main()`, say), `resolve` and
 * `reject` take effect on the thread `fromCallback` was called on, in the
 * order they were called.
 *
 * ```ts
 * import { fromCallback } from "lucent:core";
 *
 * // Who waits for the next tick, as a native listener would hold it.
 * let waiting: ((tick: number) => void) | undefined;
 *
 * export function tick(n: number): void {
 *   waiting?.(n);
 * }
 *
 * export async function nextTick(signal?: AbortSignal): Promise<number> {
 *   return await fromCallback<number>((resolve) => {
 *     waiting = resolve;
 *     return () => {
 *       waiting = undefined;
 *     };
 *   }, signal);
 * }
 * ```
 *
 * @param register Starts listening with `resolve` and `reject`, and may return the cleanup.
 * @param signal Rejects the promise with its reason, and runs the cleanup.
 */
export declare function fromCallback<T>(
  register: (resolve: (value: T) => void, reject: (reason: Error) => void) => (() => void) | void,
  signal?: AbortSignal,
): Promise<T>;

/**
 * Passes what a listener reports to `onValue` until the subscription ends,
 * and resolves when it does. `register` starts listening at once, and may
 * return the cleanup that stops it.
 *
 * `next(value)` calls `onValue(value)` while the subscription is open, and
 * does nothing after. The first of `end()`, `fail(error)`, `onValue`
 * throwing and the signal aborting ends it. The promise then resolves
 * (`end()`, or the signal: aborting is how the caller ends it) or rejects
 * with the error.
 *
 * The cleanup, a throw from `register` and calls from other threads behave
 * as in `fromCallback`. With a signal already aborted, the promise
 * resolves, and `register` is not called.
 *
 * @param register Starts listening with `next`, `end` and `fail`, and may return the cleanup.
 * @param onValue Called with each value while the subscription is open.
 * @param signal Ends the subscription, and resolves the promise.
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

/** What `addListener` returns: `remove()` takes the listener off. */
export interface EventSubscription {
  /** Removes the listener. Removing it again does nothing. */
  remove(): void;
}

/**
 * Events a module sends to its listeners, in Lucent and in JavaScript.
 * `Events` names each event and its listener's signature, as Expo's
 * `EventEmitter` does: `EventEmitter<{ progress: (percent: number) => void }>`.
 *
 * `emit(name, ...args)` calls the event's listeners, in the order they
 * were added; those added or removed while it runs take effect at the
 * next emit. A listener's throw ends the emit and reaches its caller. In
 * Lucent, an event's name is a string literal.
 *
 * An EventEmitter crosses to JavaScript as the same object each time,
 * with the same methods.
 *
 * A JavaScript listener is a callback Lucent holds. During a synchronous
 * call from JavaScript it runs at once. From anywhere else it is posted to
 * the JS thread, with copies of its arguments.
 *
 * Each JavaScript listener belongs to its runtime: a reload removes it,
 * and `listenerCount` stops counting it. In JavaScript, naming an event
 * that the type doesn't declare throws a TypeError.
 *
 * ```ts
 * import { EventEmitter } from "lucent:core";
 *
 * export const downloads = new EventEmitter<{
 *   progress: (url: string, percent: number) => void;
 *   done: (url: string) => void;
 * }>();
 *
 * export async function download(url: string): Promise<void> {
 *   for (let percent = 0; percent <= 100; percent += 10) downloads.emit("progress", url, percent);
 *   downloads.emit("done", url);
 * }
 * ```
 */
export declare class EventEmitter<Events extends { [name: string]: (...args: never[]) => void }> {
  constructor();

  /** Adds `listener` to the event's listeners, last; the subscription removes it. */
  addListener<K extends keyof Events & string>(name: K, listener: Events[K]): EventSubscription;

  /** Calls each of the event's listeners with `args`. */
  emit<K extends keyof Events & string>(name: K, ...args: Parameters<Events[K]>): void;

  /** How many listeners the event has. */
  listenerCount(name: keyof Events & string): number;

  /** Removes the event's listeners, or every event's without a name. */
  removeAllListeners(name?: keyof Events & string): void;
}

/** How a compute task runs. */
export interface ComputeOptions {
  /** Aborting it cancels the task: the promise rejects with its reason at once. */
  signal?: AbortSignal;
}

/**
 * Runs `task(input)` on a pool of worker threads, and resolves with its
 * result on the thread that called `compute`. Several tasks run at once.
 *
 * `task` is a function declared at the top level of a module, taking one
 * parameter. The compiler checks that it uses no module state, no
 * main-thread native code and nothing asynchronous (LUCENT3011). It checks
 * that `input` and its result are data too (LUCENT3012).
 *
 * `input` is copied when `compute` is called, so later changes by the
 * caller don't reach the task. Objects reached twice are copied once, and
 * cycles survive. The result comes back as it is.
 *
 * A task that throws rejects the promise with its error. Aborting `signal`
 * rejects it at once with the signal's reason, and a queued task never
 * starts.
 *
 * A running task stops at the next iteration of a loop in it, or in a
 * module function it calls. Loops in closures, methods and generic
 * functions, and native calls, run to their end first, and their result is
 * dropped.
 *
 * The pool holds a bounded number of waiting tasks: beyond it, `compute`
 * rejects with a QuotaExceededError.
 *
 * ```ts
 * import { compute } from "lucent:core";
 *
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
 *
 * @param task A function declared at the top level of a module, taking one parameter.
 * @param input Data, copied when `compute` is called.
 * @param options `signal` cancels the task.
 */
export declare function compute<T, R>(
  task: (input: T) => R,
  input: T,
  options?: ComputeOptions,
): Promise<Awaited<R>>;

/**
 * Bytes native code owns, handed to compute tasks and JavaScript without
 * copying them. A `Uint8Array` is copied whenever it crosses, while a
 * NativeBuffer moves.
 *
 * The bytes are reached through a borrow, for the length of one call.
 * `withRead` lends them to its callback as a `ByteSpan`, and `withWrite` as
 * a `MutableByteSpan`. Reads share the buffer, while a write needs it to
 * itself.
 *
 * A borrow that conflicts with one in progress throws an InvalidStateError
 * ("NativeBuffer is borrowed") at once. That is a write inside a read, or
 * a close or transfer inside either.
 *
 * The callback is a function literal or the name of a function, and its
 * span stays inside it. Returning the span, storing it, keeping it in a
 * closure or a callee, or holding it across `await` is refused (LUCENT3030).
 *
 * `transfer()` moves the bytes to a new buffer, uncopied. Every reference
 * to the old one then throws an InvalidStateError ("NativeBuffer was
 * transferred"), and closing it does nothing. A use the compiler can tell
 * follows a move is refused (LUCENT3031).
 *
 * Passing a buffer to `compute`, alone or inside the input, moves it the
 * same way, and a task's buffer comes back as it is. A buffer borrowed at
 * the time doesn't move: the promise rejects.
 *
 * After `close()`, or the end of its `using` block, the buffer throws an
 * InvalidStateError ("NativeBuffer is closed"). Copies are explicit:
 * `NativeBuffer.from(bytes)` and `toUint8Array()`, which
 * `NativeBuffer.stats()` counts.
 *
 * ```ts
 * import { compute, NativeBuffer } from "lucent:core";
 *
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
 * JavaScript sees a buffer as an opaque object with the same methods. Its
 * borrows lend it a copy of the bytes, copied back after `withWrite`, so
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
