/** Native ABI contracts are data. No SDK or host implementation is imported here. */
export type NativeExecutor = "caller" | "main" | "worker" | "serial";
export interface NativeTargets {
  ios?: string;
  android?: number;
}
export interface NativeParameterContract {
  ownership: "value" | "borrowed" | "retained";
  callback?: {
    retention: "call" | "subscription";
    executor: NativeExecutor;
    errors: "propagate" | "notify";
    remove?: string;
  };
}
export interface NativeCallContract {
  symbolId: string;
  parameters?: Record<string, NativeParameterContract>;
  result?: "value" | "owned" | "borrowed" | "external";
  executor?: NativeExecutor;
  cancellation?: "none" | "cooperative";
  availability?: NativeTargets;
}
export interface NativeObjectContract {
  ownership: "owned" | "external";
  executor: NativeExecutor;
  /** Explicit opt-in; retention alone never authorizes crossing executors. */
  transferable?: boolean;
  close?: string;
}
/** Stable across extraction order and public Lucent alias changes. */
export function nativeSymbolId(module: string, owner: string, name: string, abi: string): string {
  return JSON.stringify([module, owner, name, abi]);
}
export function supportsNativeVersion(actual: string | number | undefined, required: string | number): boolean {
  if (actual === undefined) return false;
  const left = String(actual).split(".").map(Number),
    right = String(required).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference > 0;
  }
  return true;
}
export function validNativeTargets(targets: unknown): targets is NativeTargets {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) return false;
  const value = targets as Record<string, unknown>;
  return (
    Object.keys(value).every((k) => k === "ios" || k === "android") &&
    (value.ios === undefined || (typeof value.ios === "string" && /^\d+(?:\.\d+){0,2}$/.test(value.ios))) &&
    (value.android === undefined ||
      (typeof value.android === "number" && Number.isSafeInteger(value.android) && value.android > 0))
  );
}
