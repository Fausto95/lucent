function* range(from: number, to: number, step = 1): Generator<number> {
  for (let i = from; i < to; i += step) yield i;
}

function* fib(): Generator<number> {
  let a = 0;
  let b = 1;
  for (;;) {
    yield a;
    [a, b] = [b, a + b];
  }
}

function* take<T>(xs: Iterable<T>, n: number): Generator<T> {
  if (n <= 0) return;
  let i = 0;
  for (const x of xs) {
    yield x;
    if (++i >= n) return;
  }
}

function* concat<T>(a: Iterable<T>, b: Iterable<T>): Generator<T> {
  yield* a;
  yield* b;
}

export function basics(): string {
  return [
    [...range(0, 5)].join(","),
    [...range(1, 10, 3)].join(","),
    [...take(fib(), 10)].join(","),
    [...concat([1, 2], new Set([3, 4]))].join(","),
    Array.from(take("hello", 3)).join(""),
  ].join(" | ");
}

export function lazy(): string {
  const log: string[] = [];
  function* noisy(): Generator<number> {
    log.push("start");
    yield 1;
    log.push("after 1");
    yield 2;
    log.push("end");
  }
  const g = noisy();
  log.push("created");
  const a = g.next();
  log.push(`got ${a.value} ${a.done}`);
  const b = g.next();
  log.push(`got ${b.value} ${b.done}`);
  const c = g.next();
  log.push(`done ${c.done}`);
  const d = g.next();
  log.push(`still done ${d.done}`);
  return log.join(", ");
}

export function earlyExit(): string {
  const log: string[] = [];
  function* guarded(): Generator<number> {
    try {
      yield 1;
      yield 2;
      yield 3;
    } finally {
      log.push("cleanup");
    }
  }
  for (const x of guarded()) {
    log.push(`${x}`);
    if (x === 2) break;
  }
  log.push("after loop");
  return log.join(", ");
}

export function throwsInside(): string {
  function* bad(): Generator<number> {
    yield 1;
    throw new Error("boom");
  }
  const out: string[] = [];
  try {
    for (const x of bad()) out.push(`${x}`);
  } catch (e) {
    out.push((e as Error).message);
  }
  return out.join(",");
}

class Tree {
  children: Tree[] = [];
  constructor(public label: string) {}
  add(child: Tree): Tree {
    this.children.push(child);
    return this;
  }
  *walk(depth = 0): Generator<string> {
    yield `${"-".repeat(depth)}${this.label}`;
    for (const c of this.children) yield* c.walk(depth + 1);
  }
}

export function tree(): string {
  const t = new Tree("root").add(new Tree("a").add(new Tree("a1"))).add(new Tree("b"));
  return [...t.walk()].join(" ");
}

export function closures(): string {
  const scale = 10;
  const scaled = function* (xs: number[]): Generator<number> {
    for (const x of xs) yield x * scale;
  };
  let total = 0;
  for (const v of scaled([1, 2, 3])) total += v;
  return `${total} ${[...scaled([4])].join()}`;
}

export function sumIterable(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function iterables(): string {
  const m = new Map<string, number>([
    ["a", 1],
    ["b", 2],
  ]);
  return `${sumIterable([1, 2, 3])} ${sumIterable(new Set([4, 5]))} ${sumIterable(range(0, 4))} ${sumIterable(m.values())}`;
}
