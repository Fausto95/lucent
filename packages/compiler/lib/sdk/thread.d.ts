// lucent:thread — thread affinity for platform code.

/**
 * Runs `f` on the platform's main thread (the main queue on iOS, the main
 * Looper on Android) and resolves with its result. Main-thread-only SDK
 * APIs may only be used inside `f`.
 */
export declare function main<T>(f: () => T): Promise<T>;
