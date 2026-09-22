/**
 * Platform APIs this app needs, implemented beside it in `toolkit.swift` and
 * `toolkit.kt`. Each `@Native` declaration names the signature; the sidecars
 * define `lucentNative_<name>` with matching parameter labels, and swiftc and
 * kotlinc check that they line up.
 */

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Capability("crypto")
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function sha256(bytes: Uint8Array): string;

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Capability("filesystem")
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function temporaryDirectory(): Promise<string>;

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Capability("filesystem")
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function writeFile(path: string, bytes: Uint8Array): Promise<void>;

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Capability("filesystem")
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function readFile(path: string): Promise<Uint8Array>;

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Capability("device")
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@MainThread
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function deviceModel(): Promise<string>;
