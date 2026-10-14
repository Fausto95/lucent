// Async generators, and `for await` over them (T106).
import { delay } from "lucent:core";

async function* countdown(from: number): AsyncGenerator<number> {
  for (let i = from; i > 0; i--) {
    await delay(1);
    yield i;
  }
}

export async function counted(): Promise<string> {
  const out: number[] = [];
  for await (const n of countdown(3)) out.push(n);
  return out.join(",");
}

const log: string[] = [];

async function* guarded(): AsyncGenerator<string> {
  try {
    log.push("start");
    yield "a";
    await Promise.resolve();
    yield "b";
    yield "c";
  } finally {
    log.push("finally");
  }
}

/** A loop left early closes the generator: its finally runs before the code after the loop. */
export async function leftEarly(): Promise<string> {
  log.length = 0;
  for await (const s of guarded()) {
    log.push(s);
    if (s === "b") break;
  }
  log.push("after");
  return log.join(",");
}

export async function manual(): Promise<string> {
  const it = countdown(2);
  const a = await it.next();
  const b = await it.next();
  const c = await it.next();
  const d = await it.next();
  return `${a.value}/${a.done} ${b.value}/${b.done} ${c.value}/${c.done} ${d.done}`;
}

async function* failing(): AsyncGenerator<number> {
  yield 1;
  throw new Error("boom");
}

export async function thrown(): Promise<string> {
  const got: number[] = [];
  try {
    for await (const n of failing()) got.push(n);
    return "no error";
  } catch (e) {
    return `${got.join(",")} ${e instanceof Error ? e.message : "?"}`;
  }
}

export async function returnedEarly(): Promise<string> {
  log.length = 0;
  const it = guarded();
  const first = await it.next();
  const end = await it.return(undefined);
  const after = await it.next();
  return `${first.value} ${end.done} ${after.done} ${log.join(",")}`;
}

/** Requests made while the body runs wait their turn, in order. */
export async function queued(): Promise<string> {
  const it = countdown(2);
  const [a, b, c] = await Promise.all([it.next(), it.next(), it.next()]);
  return `${a.value} ${b.value} ${c.done}`;
}

/** Started by the first next(), not by the call. */
export async function lazy(): Promise<string> {
  log.length = 0;
  const it = guarded();
  log.push("made");
  await it.next();
  return log.join(",");
}

class Source {
  constructor(private readonly items: string[]) {}

  async *each(): AsyncGenerator<string> {
    for (const item of this.items) {
      await delay(0);
      yield item.toUpperCase();
    }
  }
}

export async function fromMethodAndClosure(): Promise<string> {
  const out: string[] = [];
  for await (const s of new Source(["x", "y"]).each()) out.push(s);
  const doubled = async function* (xs: number[]): AsyncGenerator<number> {
    yield* xs.map((x) => x * 2);
  };
  for await (const n of doubled([1, 2])) out.push(`${n}`);
  return out.join(",");
}

/** A return from the loop's body, and a throw out of it, close the generator too. */
export async function leftByReturnAndThrow(): Promise<string> {
  log.length = 0;
  const first = await (async (): Promise<string> => {
    for await (const s of guarded()) return s;
    return "none";
  })();
  log.push(`returned ${first}`);
  try {
    for await (const s of guarded()) throw new Error(`stop at ${s}`);
  } catch (e) {
    log.push(e instanceof Error ? e.message : "?");
  }
  return log.join(",");
}

async function* recovering(): AsyncGenerator<string> {
  try {
    await Promise.reject(new Error("refused"));
  } catch (e) {
    yield `caught ${e instanceof Error ? e.message : "?"}`;
  }
  yield "on";
}

export async function caughtInside(): Promise<string> {
  const out: string[] = [];
  for await (const s of recovering()) out.push(s);
  return out.join(",");
}
