import { delay } from "lucent:core";

let log: string[] = [];

class Resource {
  constructor(
    readonly name: string,
    private readonly failOnDispose = false,
  ) {
    log.push(`open ${name}`);
  }

  [Symbol.dispose](): void {
    log.push(`close ${this.name}`);
    if (this.failOnDispose) throw new Error(`cannot close ${this.name}`);
  }
}

class Tracked extends Resource {
  override [Symbol.dispose](): void {
    log.push(`flush ${this.name}`);
    super[Symbol.dispose]();
  }
}

function take(): string[] {
  const out = log;
  log = [];
  return out;
}

export function scoped(): string[] {
  {
    using a = new Resource("a");
    using b = new Tracked("b");
    log.push(`body ${a.name} ${b.name}`);
  }
  log.push("after");
  return take();
}

function inner(stop: boolean): string {
  using _r = new Resource("r");
  if (stop) return "early";
  log.push("late");
  return "late";
}

export function early(stop: boolean): string[] {
  log.push(inner(stop));
  return take();
}

export function throwing(): string[] {
  try {
    using r = new Resource("r");
    log.push(`using ${r.name}`);
    throw new Error("boom");
  } catch (e) {
    log.push(`caught ${(e as Error).message}`);
  }
  return take();
}

export function loop(): string[] {
  for (const n of ["x", "y", "z"]) {
    using r = new Resource(n);
    if (r.name === "x") continue;
    if (r.name === "y") break;
    log.push("unreachable");
  }
  return take();
}

export function nullable(open: boolean): string[] {
  {
    using r = open ? new Resource("maybe") : null;
    log.push(r ? "some" : "none");
  }
  return take();
}

export function disposeThrows(): string[] {
  try {
    using r = new Resource("bad", true);
    log.push(`using ${r.name}`);
  } catch (e) {
    log.push(`caught ${(e as Error).message}`);
  }
  return take();
}

export function suppressed(): string[] {
  try {
    using r = new Resource("bad", true);
    log.push(`using ${r.name}`);
    throw new Error("boom");
  } catch (e) {
    const err = e as Error;
    log.push(`caught ${err.name}: ${err.message}`);
  }
  return take();
}

export async function inAsync(): Promise<string[]> {
  {
    using r = new Resource("async");
    await delay(1);
    log.push(`awaited ${r.name}`);
  }
  return take();
}

export function explicit(): string[] {
  const r = new Resource("explicit");
  r[Symbol.dispose]();
  return take();
}
