// The package's API: a Store class over the Lucent module's functions,
// which Metro turns into calls of their native code. JSON values are
// plain JavaScript on top: stringified here, stored as text.
import * as native from "./src/storage.lucent";

export type { Change, Value } from "./src/storage.lucent";

export class Store {
  constructor(readonly name: string) {}

  set(key: string, value: native.Value): void {
    native.set(this.name, key, value);
  }

  getString(key: string): string | null {
    return native.getString(this.name, key);
  }

  getNumber(key: string): number | null {
    return native.getNumber(this.name, key);
  }

  getBoolean(key: string): boolean | null {
    return native.getBoolean(this.name, key);
  }

  setJSON(key: string, value: unknown): void {
    native.set(this.name, key, JSON.stringify(value));
  }

  getJSON<T>(key: string): T | null {
    const text = native.getString(this.name, key);
    return text === null ? null : (JSON.parse(text) as T);
  }

  has(key: string): boolean {
    return native.has(this.name, key);
  }

  remove(key: string): void {
    native.remove(this.name, key);
  }

  keys(): string[] {
    return native.keys(this.name);
  }

  clear(): void {
    native.clear(this.name);
  }
}

/** Calls `onChange` for each write to any store, until `signal` aborts. */
export function watch(
  onChange: (change: native.Change) => void,
  signal: AbortSignal,
): Promise<void> {
  return native.watch(onChange, signal);
}
