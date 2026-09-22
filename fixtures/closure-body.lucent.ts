import type { NativeCallback } from "@lucent-lang/core/types";

function apply(value: number, callback: NativeCallback<(value: number) => number>): number {
  return callback(value);
}

export function scaled(base: number): number {
  const factor = 3;
  return apply(base, (value: number): number => {
    return value * factor;
  });
}
