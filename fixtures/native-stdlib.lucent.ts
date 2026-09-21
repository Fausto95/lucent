import { abs, sqrt } from "@lucent-lang/std/math";
import { contains, trim } from "@lucent-lang/std/text";
export function magnitude(value: number): number { return sqrt(abs(value)); }
export function matches(value: string): boolean { return contains(trim(value), "lucent"); }
import { encodeUTF8, decodeUTF8, copyBytes } from "@lucent-lang/core";
export function roundTrip(text: string): string { return decodeUTF8(copyBytes(encodeUTF8(text))); }
