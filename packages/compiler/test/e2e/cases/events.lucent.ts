import { delay, EventEmitter, type EventSubscription } from "lucent:core";

export type Progress = { url: string; percent: number };

/** What JavaScript listens to: the same object each time it reads it. */
export const downloads = new EventEmitter<{
  progress: (progress: Progress) => void;
  done: (url: string, ok: boolean) => void;
  reset: () => void;
}>();

/** Emits from async code: JavaScript's listeners are posted to its thread. */
export async function download(url: string): Promise<void> {
  for (let percent = 0; percent <= 100; percent += 50) {
    downloads.emit("progress", { url, percent });
    await delay(1);
  }
  downloads.emit("done", url, true);
}

/** Emits during a synchronous call from JavaScript: its listeners run at once. */
export function finishNow(url: string): string {
  downloads.emit("done", url, false);
  return "returned";
}

export function counts(): string {
  return ["progress", "done", "reset"]
    .map((n) =>
      n === "progress"
        ? downloads.listenerCount("progress")
        : n === "done"
          ? downloads.listenerCount("done")
          : downloads.listenerCount("reset"),
    )
    .join(" ");
}

/** Lucent's own listeners: in the order added, from the list an emit starts with. */
export function inLucent(): string {
  const log: string[] = [];
  const ticks = new EventEmitter<{ tick: (n: number) => void; fail: () => void }>();
  let second: EventSubscription | undefined;

  ticks.addListener("tick", (n) => {
    log.push(`a${n}`);
    second?.remove();
  });
  second = ticks.addListener("tick", (n) => {
    log.push(`b${n}`);
  });
  ticks.addListener("tick", (n) => {
    log.push(`c${n}`);
    if (n === 1) ticks.addListener("tick", (m) => void log.push(`d${m}`));
  });
  ticks.emit("tick", 1);
  ticks.emit("tick", 2);
  log.push(`count ${ticks.listenerCount("tick")}`);
  second.remove();
  ticks.removeAllListeners("tick");
  ticks.emit("tick", 3);

  ticks.addListener("fail", () => {
    throw new Error("listener failed");
  });
  ticks.addListener("fail", () => void log.push("not reached"));
  try {
    ticks.emit("fail");
  } catch (e) {
    log.push((e as Error).message);
  }
  ticks.removeAllListeners();
  log.push(`count ${ticks.listenerCount("fail")}`);
  return log.join(" ");
}

export type Pings = EventEmitter<{ ping: (n: number, label?: string) => void }>;

/** An emitter JavaScript gets back, and hands in again. */
export function make(): Pings {
  return new EventEmitter<{ ping: (n: number, label?: string) => void }>();
}

export function ping(pings: Pings, n: number): number {
  pings.emit("ping", n);
  pings.emit("ping", n + 1, "labelled");
  return pings.listenerCount("ping");
}
