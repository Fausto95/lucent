import { abs, sqrt } from "@lucent-lang/std/math";
import { contains, trim } from "@lucent-lang/std/text";
export function magnitude(value: number): number { return sqrt(abs(value)); }
export function matches(value: string): boolean { return contains(trim(value), "lucent"); }
