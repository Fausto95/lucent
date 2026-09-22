import { delay } from "@lucent-lang/core";

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
