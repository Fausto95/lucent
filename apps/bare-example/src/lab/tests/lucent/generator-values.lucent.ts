// A generator's `yield` gives what next(v) sends, its `return v` is the
// result of the step that ends it, and throw(e) throws where it waits.

function* echo(): Generator<string, number, string> {
  let got = 0;
  for (;;) {
    const v = yield "ready";
    if (v === "stop") break;
    got++;
  }
  return got;
}

export function sending(): string {
  const g = echo();
  const out: string[] = [];
  out.push(`${g.next().value}`);
  out.push(`${g.next("a").value}`);
  out.push(`${g.next("b").value}`);
  const end = g.next("stop");
  out.push(`${end.value} ${end.done}`);
  // Done: the result is reported once (JavaScript's value after that is undefined).
  out.push(`${g.next("x").done}`);
  return out.join(",");
}

function* careful(): Generator<number, string, undefined> {
  try {
    yield 1;
    yield 2;
  } catch (e) {
    if (e instanceof Error) {
      yield 10;
      return `caught ${e.message}`;
    }
  } finally {
    console.log("finally");
  }
  return "done";
}

export function throwing(): string {
  const g = careful();
  const out: string[] = [];
  out.push(`${g.next().value}`);
  const caught = g.throw(new Error("boom"));
  out.push(`${caught.value} ${caught.done}`);
  const end = g.next();
  out.push(`${end.value} ${end.done}`);
  try {
    g.throw(new Error("again"));
  } catch (e) {
    if (e instanceof Error) out.push(`threw ${e.message}`);
  }
  try {
    careful().throw(new TypeError("early"));
  } catch (e) {
    if (e instanceof Error) out.push(`unstarted ${e.name}`);
  }
  return out.join(",");
}

export function returning(): string {
  const g = careful();
  const out: string[] = [];
  out.push(`${g.next().value}`);
  const r = g.return("early");
  out.push(`${r.value} ${r.done}`);
  out.push(`${g.next().done}`);
  const fresh = careful().return("never started");
  out.push(`${fresh.value} ${fresh.done}`);
  return out.join(",");
}

function* outer(): Generator<string, number, string> {
  const inner = yield* echo();
  yield `inner gave ${inner}`;
  yield* ["x", "y"];
  return inner * 10;
}

export function delegating(): string {
  const g = outer();
  const out: string[] = [];
  out.push(`${g.next().value}`);
  out.push(`${g.next("one").value}`);
  out.push(`${g.next("stop").value}`);
  for (let r = g.next(); ; r = g.next()) {
    out.push(`${r.value}`);
    if (r.done) break;
  }
  return out.join(",");
}

function* guarded(): Generator<number, string, undefined> {
  const r = yield* careful();
  return `inner: ${r}`;
}

export function delegatedThrow(): string {
  const g = guarded();
  const out: string[] = [];
  out.push(`${g.next().value}`);
  out.push(`${g.throw(new Error("in")).value}`);
  out.push(`${g.next().value}`);
  return out.join(",");
}

// A for…of takes each value; what the generator returns, it leaves.
export function iterating(): string {
  const seen: number[] = [];
  for (const v of careful()) seen.push(v);
  return seen.join(",");
}

// yield* over an array's iterator, which has no throw(): it is closed, and the error is a TypeError.
function* overArray(): Generator<number, void, undefined> {
  try {
    yield* [1, 2, 3];
  } catch (e) {
    if (e instanceof Error) console.log(e.name);
  }
}

export function arrayThrow(): string {
  const g = overArray();
  const first = g.next();
  const r = g.throw(new Error("x"));
  return `${first.value} ${r.done}`;
}

// --- in classes, closures and expressions ---------------------------------------

class Tally {
  total = 0;
  *adder(): Generator<number, number, number> {
    for (;;) {
      const n = yield this.total;
      if (n < 0) return this.total;
      this.total += n;
    }
  }
}

export function inClass(): string {
  const t = new Tally();
  const g = t.adder();
  g.next();
  g.next(2);
  g.next(3);
  const end = g.next(-1);
  return `${end.value} ${end.done} ${t.total}`;
}

export function nested(): string {
  const log: string[] = [];
  function* collect(): Generator<number, string[], string> {
    const got: string[] = [];
    let i = 0;
    while (got.length < 2) got.push(yield i++);
    log.push("collected");
    return got;
  }
  const g = collect();
  g.next();
  g.next("a");
  const r = g.next("b");
  const v = r.value;
  return `${Array.isArray(v) ? v.join("+") : v} ${r.done} ${log.join()}`;
}

export function inExpressions(): string {
  function* sum(): Generator<string, number, number> {
    const total = (yield "first") + (yield "second");
    return total * 2;
  }
  const g = sum();
  const a = g.next().value;
  const b = g.next(5).value;
  const end = g.next(7);
  return `${a} ${b} ${end.value}`;
}

export function asIterable(): string {
  function* three(): Generator<number, string, undefined> {
    yield 1;
    yield 2;
    yield 3;
    return "end";
  }
  const spread = [...three()];
  const from = Array.from(three());
  let total = 0;
  for (const v of three()) total += v;
  return `${spread.join()} ${from.length} ${total}`;
}

export function returnInFinally(): string {
  function* g(): Generator<number, string, undefined> {
    try {
      yield 1;
    } finally {
      yield 99;
    }
    return "normal";
  }
  const it = g();
  it.next();
  const r1 = it.return("early");
  const r2 = it.next();
  return `${r1.value} ${r1.done} ${r2.value} ${r2.done}`;
}
