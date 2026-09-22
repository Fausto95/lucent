/**
 * An SDK string handle. `@NativeReference` maps the alias onto the platform
 * type and states the contract the borrow and executor checks read; the
 * operations are implemented in `native-text.swift` and `native-text.kt`.
 */

// @ts-expect-error Lucent type decorator; compiled before TypeScript.
@NativeReference({ swift: "NSString", kotlin: "String", ownership: "owned", executor: "caller", transferable: true })
export type NativeText = { length: number };

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function NativeText__create(value: string): NativeText;

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Native
export declare function NativeText__get_length(lucentSelf: NativeText): number;
