/**
 * Helpers available to Lucent modules. Each one has a native implementation
 * in the Lucent runtime and a JavaScript implementation (index.js) so the
 * same source also runs as plain TypeScript, e.g. in unit tests.
 */

/** Resolves after `ms` milliseconds. */
export declare function delay(ms: number): Promise<void>;

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
