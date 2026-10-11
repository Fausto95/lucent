// onObserved: a module hears when an event gets its first listener, from
// Lucent or JavaScript, and when its last one goes, to start and stop the
// native source behind it.
import { EventEmitter, type EventSubscription } from "lucent:core";

type Events = {
  reading: (value: number) => void;
  status: (text: string) => void;
};

export const sensor = new EventEmitter<Events>();
const seen: string[] = [];
let running = false;

// Stands for starting and stopping the hardware.
function watch(): EventSubscription {
  return sensor.onObserved("reading", (observed) => {
    running = observed;
    seen.push(`reading ${observed ? "on" : "off"}`);
  });
}

let watching = watch();

/** What the observer heard since the last call, and whether the source runs. */
export function observed(): string {
  const out = seen.length ? seen.join(", ") : "-";
  seen.length = 0;
  return `${out} (running ${running})`;
}

/** Lucent's own listeners: the first starts it, the last stops it. */
export function fromLucent(): string {
  const a = sensor.addListener("reading", () => {});
  const b = sensor.addListener("reading", () => {});
  const first = observed();
  a.remove();
  a.remove();
  const one = observed();
  b.remove();
  return `${first} | ${one} | ${observed()}`;
}

/** removeAllListeners, for one event or every event. */
export function removed(): string {
  sensor.addListener("reading", () => {});
  sensor.addListener("status", () => {});
  const added = observed();
  sensor.removeAllListeners("status");
  const status = observed();
  sensor.removeAllListeners();
  return `${added} | ${status} | ${observed()}`;
}

/**
 * An observer added while the event has listeners hears `true` at once;
 * removed, it hears nothing more. Observers of one event don't hear another's.
 */
export function late(): string {
  const local = new EventEmitter<Events>();
  const heard: string[] = [];
  const listening = local.addListener("status", () => {});
  const observer = local.onObserved("status", (o) => heard.push(`status ${o}`));
  local.onObserved("reading", (o) => heard.push(`reading ${o}`));
  listening.remove();
  observer.remove();
  local.addListener("status", () => {});
  local.addListener("reading", () => {}).remove();
  return heard.join(", ");
}

/** An observer may add and remove listeners itself. */
export function reentrant(): string {
  const local = new EventEmitter<Events>();
  const heard: string[] = [];
  local.onObserved("reading", (o) => {
    heard.push(`reading ${o}`);
    if (o) local.addListener("status", () => {}).remove();
  });
  local.onObserved("status", (o) => heard.push(`status ${o}`));
  local.addListener("reading", () => {}).remove();
  return heard.join(", ");
}

/** Removing the module's observer: listeners come and go unheard. */
export function stopWatching(): string {
  watching.remove();
  sensor.addListener("reading", () => {}).remove();
  const unheard = observed();
  watching = watch();
  return unheard;
}
