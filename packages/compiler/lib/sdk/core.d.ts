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
