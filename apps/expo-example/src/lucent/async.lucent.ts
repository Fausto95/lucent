import { delay } from "lucent:core";

export async function double(n: number): Promise<number> {
  await delay(5);
  return n * 2;
}

export async function sequence(xs: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const x of xs) out.push(await double(x));
  return out;
}

export async function parallel(xs: number[]): Promise<number[]> {
  return Promise.all(xs.map((x) => double(x)));
}

export async function failing(msg: string): Promise<string> {
  await delay(1);
  throw new Error(msg);
}

export async function recovers(): Promise<string> {
  try {
    await failing("boom");
    return "no";
  } catch (e) {
    return `caught ${(e as Error).message}`;
  } finally {
    await delay(1);
  }
}

export async function withProgress(steps: number, onStep: (i: number) => void): Promise<string> {
  for (let i = 1; i <= steps; i++) {
    await delay(2);
    onStep(i);
  }
  return "done";
}

export async function askJs(ask: (q: string) => Promise<number>): Promise<number> {
  const a = await ask("first");
  const b = await ask("second");
  return a + b;
}

export class Loader {
  private cache = new Map<string, string>();
  loads = 0;

  async load(key: string): Promise<string> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    await delay(3);
    this.loads++;
    const value = key.toUpperCase();
    this.cache.set(key, value);
    return value;
  }
}

export async function orderCheck(): Promise<string> {
  const log: string[] = [];
  const task = async (name: string, ms: number) => {
    log.push(`start ${name}`);
    await delay(ms);
    log.push(`end ${name}`);
    return name;
  };
  const a = task("a", 20);
  const b = task("b", 5);
  log.push("both started");
  await Promise.all([a, b]);
  return log.join(", ");
}

export async function voidAsync(log: (s: string) => void): Promise<void> {
  await delay(1);
  log("void async ran");
}

export async function noAwait(x: number): Promise<number> {
  return x + 1;
}

export async function allRejectsEarly(): Promise<string> {
  const log: string[] = [];
  const slow = async (): Promise<number> => {
    await delay(40);
    log.push("slow settled");
    return 1;
  };
  const fast = async (): Promise<number> => {
    await delay(1);
    throw new Error("fast failed");
  };
  try {
    await Promise.all([slow(), fast()]);
  } catch (e) {
    log.push(`caught ${(e as Error).message}`);
  }
  await delay(60);
  return log.join(", ");
}

export async function tupleRejectsEarly(): Promise<string> {
  const log: string[] = [];
  const slow = async (): Promise<string> => {
    await delay(40);
    log.push("slow settled");
    return "s";
  };
  const fast = async (): Promise<number> => {
    await delay(1);
    throw new Error("fast failed");
  };
  try {
    const [s, n] = await Promise.all([slow(), fast()]);
    log.push(`${s}${n}`);
  } catch (e) {
    log.push(`caught ${(e as Error).message}`);
  }
  await delay(60);
  return log.join(", ");
}

export async function allTicks(): Promise<string> {
  const log: string[] = [];
  const ticker = async () => {
    for (let i = 0; i < 5; i++) {
      await noAwait(i);
      log.push(`t${i}`);
    }
  };
  const t = ticker();
  const [a, b, c] = await Promise.all([noAwait(1), noAwait(2), noAwait(3)]);
  log.push(`all ${a + b + c}`);
  await t;
  return log.join(", ");
}

/** new Promise: the executor runs at once; resolve and reject settle it once. */
export function promised(v: number): Promise<number> {
  return new Promise((resolve) => {
    const later = async () => {
      await delay(1);
      resolve(v * 2);
    };
    void later();
  });
}

export function promiseRejects(): Promise<number> {
  return new Promise((_resolve, reject) => reject(new RangeError("nope")));
}

export function promiseThrows(): Promise<number> {
  return new Promise(() => {
    throw new TypeError("thrown");
  });
}

export function promiseSettlesOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    resolve("first");
    resolve("second");
    reject(new Error("late"));
  });
}

export async function promiseOfNothing(): Promise<string> {
  const order: string[] = [];
  const p = new Promise<void>((resolve) => {
    order.push("executor");
    resolve();
  });
  order.push("constructed");
  await p;
  order.push("after");
  return order.join(",");
}
