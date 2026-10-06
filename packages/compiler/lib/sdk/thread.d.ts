// lucent:thread — thread affinity for platform code.

/**
 * Runs `f` on the platform's main thread (the main queue on iOS, the main
 * Looper on Android), and resolves with its result. Main-thread-only SDK
 * APIs may only be used inside `f`.
 *
 * `f` runs holding the lock module code shares, and the main thread waits
 * for any module job before it starts. Keep it short.
 *
 * @param f The code to run on the main thread: its result resolves the promise.
 */
export declare function main<T>(f: () => T): Promise<T>;
