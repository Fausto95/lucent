// JSValue: a value JavaScript gave, which Lucent holds without looking
// inside and hands back as the same value: an object keeps its identity,
// a function stays callable, a primitive stays itself.
import type { JSValue } from "lucent:core";

export class Holder {
  constructor(readonly value: JSValue) {}
}

export type Tagged = { tag: string; value: JSValue };

export function echo(value: JSValue): JSValue {
  return value;
}

export function keep(value: JSValue): Holder {
  return new Holder(value);
}

export function tagged(tag: string, value: JSValue): Tagged {
  return { tag, value };
}

export function swapped(a: JSValue, b: JSValue): JSValue[] {
  return [b, a];
}

/** An optional one is absent for JavaScript's undefined and null, as `??` sees them. */
export function orElse(value: JSValue | undefined, fallback: JSValue): JSValue {
  return value ?? fallback;
}

export function given(value: JSValue | undefined): string {
  return value === undefined ? "absent" : "given";
}

let stored: JSValue | undefined;

export function store(value: JSValue): void {
  stored = value;
}

export function restored(): JSValue | undefined {
  return stored;
}

export function clear(): void {
  stored = undefined;
}

export async function later(value: JSValue): Promise<JSValue> {
  await Promise.resolve();
  return value;
}

/** Handed to a JavaScript callback, it is the same value again. */
export function handBack(value: JSValue, read: (value: JSValue) => string): string {
  return read(value);
}

/** Kept by a closure. */
export function remembered(value: JSValue): () => JSValue {
  return () => value;
}
