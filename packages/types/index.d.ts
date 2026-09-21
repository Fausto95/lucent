/**
 * Sized numeric types for Lucent modules. At the JavaScript boundary every one
 * of them is a `number`; the brand only exists so the Lucent compiler can pick
 * the native representation. `import type { int32 } from "@lucent-lang/types"`.
 */
declare const brand: unique symbol;
type Sized<Name extends string> = number & { readonly [brand]?: Name };

export type int8 = Sized<"int8">;
export type int16 = Sized<"int16">;
export type int32 = Sized<"int32">;
export type int64 = Sized<"int64">;
export type uint8 = Sized<"uint8">;
export type uint16 = Sized<"uint16">;
export type uint32 = Sized<"uint32">;
export type uint64 = Sized<"uint64">;
export type float32 = Sized<"float32">;
export type float64 = Sized<"float64">;

declare global {
  /** The only throwable in Lucent code. Reaches JavaScript as an Error with `code`. */
  class LucentError extends Error {
    constructor(code: string, options?: { message?: string });
    readonly code: string;
  }
}
