import { encodeUTF8 } from "@lucent-lang/core";

/** Explicit copy of bytes (Gate A P45). */
export function clone(text: string): Uint8Array {
  const bytes = encodeUTF8(text);
  return copy(bytes);
}
