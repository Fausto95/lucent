// An exported const holding an object: JavaScript reads it from the module,
// and a host that replaces this one (Lucent reinstalled in the same runtime,
// the exports JavaScript kept) hands out its own handle to it.
import { EventEmitter } from "lucent:core";

type Settings = { size: number };

export const pings = new EventEmitter<{ ping: (n: number) => void }>();
export const settings: Settings = { size: 2 };
export const limit = 3;

export function ping(n: number): number {
  pings.emit("ping", n);
  return pings.listenerCount("ping");
}
