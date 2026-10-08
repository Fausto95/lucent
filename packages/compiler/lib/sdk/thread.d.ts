// lucent:thread — thread affinity for platform code.

/**
 * Runs `f` on the platform's main thread (the main queue on iOS, the main
 * Looper on Android), and resolves with its result. Main-thread-only SDK
 * APIs may only be used inside `f`.
 *
 * `f` runs holding its module's lock (its package's actor), so it may use
 * module state. The main thread never waits for module code: `f` starts
 * once that actor is free, so a long job of the same package delays `f`,
 * not the main thread. While `f` runs, the package's other work waits:
 * keep it short.
 *
 * @param f The code to run on the main thread: its result resolves the promise.
 */
export declare function main<T>(f: () => T): Promise<T>;
