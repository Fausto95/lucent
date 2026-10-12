// lucent:thread — thread affinity for platform code.

/**
 * Runs `f` on the platform's main thread (the main queue on iOS, the main
 * Looper on Android), and resolves with its result. Main-thread-only SDK
 * APIs may only be used inside `f`.
 *
 * `f` runs holding its module's lock (its package's actor), so it may use
 * module state. The main thread never waits for module code. `f` starts
 * once that actor is free: a long job of the same package delays `f`, not
 * the main thread.
 *
 * While `f` runs, the package's other work waits: keep it short.
 *
 * @param f The code to run on the main thread: its result resolves the promise.
 */
export declare function main<T>(f: () => T): Promise<T>;

/**
 * A serial executor: a thread of its own that never takes a module's lock.
 * SDK calls that take a queue (iOS) or a `java.util.concurrent.Executor`
 * (Android) take it as it is. Code handed to the platform with `on()` runs
 * on it one call at a time, beside module code, never behind it.
 */
export declare class Executor {
  private readonly __lucent_Executor: never;
  /** The name it was made with, as Instruments, Perfetto and crash reports show it. */
  readonly label: string;
  /**
   * Java's `Executor.execute`, which Android APIs call to run their work on
   * it. Lucent code hands it work with `on()` instead.
   */
  execute(command: never): void;
}

/**
 * A new serial executor, for platform callbacks that must not wait behind
 * module code: a camera's frames, an audio block, a socket's reads.
 *
 * ```ts
 * import { Channel } from "lucent:core";
 * import { PLATFORM } from "lucent:platform";
 * import { LocationManager } from "lucent:android/android.location";
 * import { appContext, available } from "lucent:android";
 * import { executor, on } from "lucent:thread";
 *
 * export async function altitude(): Promise<number> {
 *   if (PLATFORM === "ios") return 0;
 *   const manager = appContext().getSystemService(LocationManager);
 *   if (!manager || !available("android", 30)) return 0;
 *
 *   const fixes = executor("location.fixes");
 *   const altitudes = new Channel<number>("latest");
 *   manager.getCurrentLocation(LocationManager.GPS_PROVIDER, null, fixes, on(fixes, (fix) => {
 *     altitudes.send(fix ? fix.getAltitude() : 0);
 *   }));
 *   return (await altitudes.receive()) ?? 0;
 * }
 * ```
 *
 * @param label Its name, such as `"camera.frames"`.
 */
export declare function executor(label: string): Executor;

/**
 * Hands `f` to the platform to run on `executor`, never holding its
 * module's lock. Pass the result straight to the SDK call that takes it.
 *
 * When the platform calls `f` on the executor, `f` runs there at once.
 * Called from another thread, an `f` that returns nothing runs in a turn
 * of the executor. One that returns a value is reported as an error.
 *
 * `f` runs beside module code, so it shares nothing with it. It may not
 * use module state, call JavaScript callbacks or await. It captures only
 * `const` numbers, strings, booleans and bigints, Channels and Executors,
 * and what it makes leaves through a `Channel`.
 *
 * @param executor The executor `f` runs on.
 * @param f The callback the platform calls.
 */
export declare function on<F>(executor: Executor, f: F): F;
