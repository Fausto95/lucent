import { delay } from "@lucent-lang/core";

export async function waitOrStop(ms: number, signal: AbortSignal): Promise<string> {
  try {
    await delay(ms, signal);
    return "finished";
  } catch (e) {
    return `stopped: ${(e as Error).name}`;
  }
}

export async function tickUntilAborted(signal: AbortSignal): Promise<string> {
  let ticks = 0;
  while (!signal.aborted) {
    await delay(1);
    ticks++;
  }
  return ticks > 0 ? "ticked, then aborted" : "aborted before the first tick";
}

export function check(signal: AbortSignal): string {
  try {
    signal.throwIfAborted();
    return "running";
  } catch (e) {
    return `thrown ${(e as Error).name}`;
  }
}

export function checkOptional(signal?: AbortSignal): string {
  return signal === undefined ? "no signal" : check(signal);
}

export async function controllerInLucent(): Promise<string> {
  const c = new AbortController();
  const log: string[] = [];
  c.signal.addEventListener("abort", () => log.push("listener"));
  const waiting = (async () => {
    try {
      await delay(1000, c.signal);
      log.push("late");
    } catch (e) {
      log.push(`caught ${(e as Error).name}`);
    }
  })();
  log.push(`before ${c.signal.aborted}`);
  c.abort();
  log.push(`after ${c.signal.aborted}`);
  c.abort();
  await waiting;
  log.push(check(c.signal));
  return log.join(", ");
}

export async function customReason(): Promise<string> {
  const c = new AbortController();
  c.abort(new Error("stop please"));
  try {
    await delay(10, c.signal);
    return "not stopped";
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
}

export async function abortedMidway(signal: AbortSignal): Promise<string> {
  const log: string[] = [];
  signal.addEventListener("abort", () => log.push("js aborted"));
  try {
    await delay(1000, signal);
  } catch (e) {
    log.push(`caught ${(e as Error).name}`);
  }
  log.push(`aborted=${signal.aborted}`);
  return log.join(", ");
}
