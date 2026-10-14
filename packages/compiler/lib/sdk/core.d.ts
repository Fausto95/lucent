/**
 * lucent:core: helpers every module can import. Each has a native
 * implementation in the Lucent runtime, and a JavaScript one in
 * `@lucent-lang/lucent/core`, so the same source also runs as TypeScript.
 */

/**
 * Runs `hook` when this module's state ends: before a JavaScript reload
 * initializes the module again, or when the app's JavaScript runtime goes,
 * as Expo's `OnDestroy` does. A module's top-level code is its create hook.
 * Stop there what module code started for this state and that a reload
 * would leave running, such as an SDK observer.
 *
 * Module state is the app's, whichever runtime started it. A second React
 * Native instance shares it, and it ends only when the last one goes.
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

  /**
   * Calls `observer(true)` when the event gets its first listener, from
   * Lucent or JavaScript, and `observer(false)` when its last one goes:
   * removed, or taken by a reload. It is called at once with `true` if the
   * event has listeners already. The subscription stops it. Use it to
   * start the native source behind an event only while someone listens.
   *
   * ```ts
   * import { EventEmitter } from "lucent:core";
   *
   * export const motion = new EventEmitter<{ reading: (x: number, y: number, z: number) => void }>();
   *
   * // For the module's life: the top level holds declarations.
   * const watching = motion.onObserved("reading", (observed) => {
   *   if (observed) startAccelerometer();
   *   else stopAccelerometer();
   * });
   *
   * function startAccelerometer(): void {}
   * function stopAccelerometer(): void {}
   * ```
   *
   * @param name The event.
   * @param observer Called with whether the event has listeners now.
   */
  onObserved(name: keyof Events & string, observer: (observed: boolean) => void): EventSubscription;
}

/**
 * A value JavaScript gave, which Lucent code holds without looking inside:
 * another library's object, a callback to hand back, any value. Lucent
 * code stores it, passes it on and returns it, and JavaScript gets the
 * same value back. An object keeps its identity, a function stays
 * callable, a primitive stays itself.
 *
 * Nothing else reads it: comparing, converting, testing or `typeof` one is
 * refused. So are writing it as JSON, keying a `Map` or `Set` with it, and
 * handing it to a compute task. An optional one (`JSValue | undefined`) is
 * absent for JavaScript's `undefined` and `null`, as `??` sees them.
 *
 * The runtime's host holds the value until the last Lucent reference goes.
 * One held across a reload is refused when it goes back to JavaScript.
 *
 * ```ts
 * import type { JSValue } from "lucent:core";
 *
 * export class Player {
 *   constructor(readonly source: JSValue) {}
 * }
 *
 * export function play(source: JSValue): Player {
 *   return new Player(source);
 * }
 * ```
 */
export declare class JSValue {
  private constructor();
  private readonly opaque: never;
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
 * `withReadAs` and `withWriteAs` lend them as another typed array's
 * elements: `buffer.withReadAs(Float32Array, (samples) => …)`.
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

  /**
   * Calls `write` with the bytes, while nothing else borrows them, and
   * returns what it returns. A read-only buffer (a frame adopted for
   * reading) throws InvalidStateError.
   */
  withWrite<R>(write: (bytes: MutableByteSpan) => R): R;

  /**
   * Calls `read` with the bytes read as `type`'s elements, little-endian,
   * as `new Float32Array(buffer)` reads them. Bytes that aren't a whole
   * number of elements throw a RangeError.
   */
  withReadAs<A extends ViewedArray, R>(
    type: ViewedArrayType<A>,
    read: (values: TypedSpan<A>) => R,
  ): R;

  /** Calls `write` with the bytes as `type`'s elements, as `withWrite` and `withReadAs` do. */
  withWriteAs<A extends ViewedArray, R>(
    type: ViewedArrayType<A>,
    write: (values: MutableTypedSpan<A>) => R,
  ): R;

  /** A copy of the bytes, independent of the buffer from then on. */
  toUint8Array(): Uint8Array;

  /** Moves the bytes, uncopied, to a new buffer: every reference to this one refuses them from now on. */
  transfer(): NativeBuffer;

  /**
   * Moves the bytes, uncopied, into an `ArrayBuffer`. Every reference to
   * this buffer refuses them from now on, and the ArrayBuffer releases
   * them as the buffer would have. Returned to JavaScript, it is the same
   * bytes. A borrowed buffer does not move (an InvalidStateError), nor
   * does a read-only one, since an ArrayBuffer is writable.
   */
  transferToArrayBuffer(): ArrayBuffer;

  /** Releases the bytes. Closing a closed or transferred buffer does nothing. */
  close(): void;

  /**
   * A handle of the bytes' address, for native code that takes one (a
   * library JavaScript passes the pointer to). It borrows the bytes for
   * read until it is released: reads go on, while writes, `transfer()` and
   * `close()` throw an InvalidStateError. An empty buffer has no address
   * (a RangeError).
   */
  handle(): NativeHandle;

  [Symbol.dispose](): void;
}

/**
 * An address native code takes, held valid until released, as
 * VisionCamera's `NativeBuffer` gives one to Skia. JavaScript gets the same
 * object, and passes `pointer` to the library that reads it.
 *
 * Release it once done, from Lucent or JavaScript: until then, what it
 * points to stays as it is (a buffer's bytes stay borrowed). One whose
 * last reference goes unreleased is released then; a debug build counts
 * those JavaScript collected (`host.releasedOpen` in
 * `__lucentDebug.snapshot()`).
 */
export declare class NativeHandle {
  private constructor();

  /** The address while held: `0n` once released. */
  readonly pointer: bigint;

  /** Whether it was released. */
  readonly released: boolean;

  /** Releases it: true the first time, false after. */
  release(): boolean;
}

/**
 * A class whose instances hold native memory the JavaScript collector
 * can't see: an image's pixels, a model's weights. `nativeSize` is how
 * many bytes, which the collector counts toward each instance's object,
 * so that holding many of them collects them sooner. Lucent reads it
 * each time an instance crosses to JavaScript, and after each call
 * JavaScript makes on it.
 *
 * ```ts
 * import { NativeBuffer, type NativeSized } from "lucent:core";
 *
 * export class Image implements NativeSized {
 *   private pixels = NativeBuffer.allocate(0);
 *   get nativeSize(): number {
 *     return this.pixels.byteLength;
 *   }
 *   load(width: number, height: number): void {
 *     this.pixels = NativeBuffer.allocate(width * height * 4);
 *   }
 * }
 * ```
 */
export interface NativeSized {
  /** The bytes of native memory an instance holds: 0 when it holds none. */
  readonly nativeSize: number;
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

/** The typed arrays a buffer's bytes can be read as. */
export type ViewedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** A typed array's constructor, which names the elements `withReadAs` lends: `Float32Array`. */
export interface ViewedArrayType<A extends ViewedArray> {
  new (buffer: ArrayBuffer): A;
  readonly BYTES_PER_ELEMENT: number;
}

/**
 * The bytes `withReadAs` lends, read like a typed array of kind `A`:
 * `values[i]` is undefined out of range.
 */
export interface TypedSpan<A extends ViewedArray> {
  readonly length: number;
  readonly [index: number]: A[number];
}

/**
 * The bytes `withWriteAs` lends, written like a typed array of kind `A`:
 * values convert as `A` converts them, writes out of range do nothing.
 */
export interface MutableTypedSpan<A extends ViewedArray> extends TypedSpan<A> {
  [index: number]: A[number];

  /** Sets the elements from `start` to `end` (counted from the end when negative) to `value`. */
  fill(value: A[number], start?: number, end?: number): void;

  /** Copies `source`'s values in at `offset`: a RangeError if they do not fit. */
  set(source: ArrayLike<A[number]>, offset?: number): void;
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

/**
 * What a channel does when its consumer has no room for a value:
 * `"lossless"` refuses the send, `"latest"` keeps only the newest value,
 * `"drop"` drops the oldest.
 */
export type ChannelPolicy = "lossless" | "latest" | "drop";

/**
 * Values from a producer to a consumer, which may run on different
 * threads. A compute task sends results as it goes, and module code
 * receives them. A send never waits for the consumer; when the
 * consumer falls behind, the channel's policy decides what waits.
 *
 * A value is copied when it is sent, as a compute task's input is, so
 * the consumer has its own; a `NativeBuffer` moves instead. A value the
 * channel drops, or that is never received, is released: a
 * `NativeBuffer` is closed.
 *
 * ```ts
 * import { Channel, compute } from "lucent:core";
 *
 * function scan(input: { rows: number[][]; progress: Channel<number> }): number {
 *   for (let i = 0; i < input.rows.length; i++) input.progress.send(i + 1);
 *   input.progress.close();
 *   return input.rows.length;
 * }
 *
 * export async function scanAll(rows: number[][]): Promise<number> {
 *   const progress = new Channel<number>("latest");
 *   const done = compute(scan, { rows, progress });
 *   for (let n = await progress.receive(); n !== undefined; n = await progress.receive())
 *     console.log(`row ${n}`);
 *   return await done;
 * }
 * ```
 */
export declare class Channel<T> {
  /**
   * @param policy What a send does when the channel is full.
   * @param capacity How many values wait at most: a whole number from 1,
   * 16 by default; a latest channel holds 1.
   */
  constructor(policy: ChannelPolicy, capacity?: number);

  /**
   * Sends a copy of `value` (a `NativeBuffer` moves), without waiting.
   * False if refused: the channel is closed, or lossless and full; the
   * value is then left as it was.
   */
  send(value: T): boolean;

  /**
   * The next value: at once if one waits, else when one is sent;
   * `undefined` once the channel is closed and every value was received.
   */
  receive(): Promise<T | undefined>;

  /**
   * `for await (const value of channel)`: each value it receives, until
   * `receive()` gives `undefined`, once it is closed and every value was
   * received. Leaving the loop early leaves the channel as it is.
   */
  [Symbol.asyncIterator](): AsyncIterator<T>;

  /**
   * Calls `onValue` with each value as it comes, one at a time, where this
   * code runs. The next is received once `onValue` returns, so the policy
   * still decides what waits meanwhile. It goes on until the channel is
   * closed and every value was received, or until the subscription is
   * removed. After that, values wait for the next receive. What `onValue` throws is
   * reported, and the next value comes.
   */
  subscribe(onValue: (value: T) => void): EventSubscription;

  /**
   * Refuses sends from now on; what waits can still be received. False if
   * it was closed already.
   */
  close(): boolean;

  /** Whether it is closed. */
  readonly closed: boolean;

  /** What it has done so far, and how many values wait now. */
  stats(): ChannelStats;
}

/** Counts of what a channel has done, for checking what its policy dropped. */
export interface ChannelStats {
  /** Values it took. */
  readonly sent: number;
  /** Values the consumer received. */
  readonly received: number;
  /** Values released unreceived: dropped by its policy, or left when it ended. */
  readonly dropped: number;
  /** Sends refused: into a full lossless channel, or a closed one. */
  readonly refused: number;
  /** Values waiting now, and the most that ever waited. */
  readonly depth: number;
  readonly highWater: number;
}
