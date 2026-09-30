// Assignment order: a compound assignment evaluates its target's parts,
// reads the target, then runs the right side, and stores last; each part
// runs once, and a right side that throws stores nothing.

let trace = "";
let log = "";
let count = 100;
let maybe: number | undefined = undefined;
let flag = true;

export function reset(): void {
  trace = "";
  log = "";
  count = 100;
  maybe = undefined;
  flag = true;
  shared = { n: 0, s: "shared" };
  items = [1, 2, 3];
}

export function trail(): string {
  return trace;
}

function note(tag: string): void {
  trace = `${trace}${tag} `;
}

function relog(tag: string): string {
  log = `<${tag}>`;
  note(tag);
  return tag;
}

function bump(by: number): number {
  count = count + 1000;
  note(`bump${by}`);
  return by;
}

function boom(tag: string): number {
  note(tag);
  throw new Error(`${tag} failed`);
}

function index(i: number): number {
  note(`i${i}`);
  return i;
}

export function moduleString(): string {
  log = "a";
  log += relog("x");
  return log;
}

export function moduleNumbers(): string {
  const out: number[] = [];

  count += bump(1);
  out.push(count);
  count -= bump(2);
  out.push(count);
  count *= bump(3);
  out.push(count);
  count /= bump(4);
  out.push(count);
  count %= bump(7);
  out.push(count);
  count **= bump(2);
  out.push(count);
  count = 6;
  count |= bump(1);
  out.push(count);
  count <<= bump(2);
  out.push(count);
  return out.join(" ");
}

export function moduleLogical(): string {
  const first = (maybe ??= setMaybe(7));
  const second = (maybe ??= setMaybe(8));
  const off = (flag &&= setFlag(false));
  const on = (flag ||= setFlag(true));

  return `${first} ${second} ${maybe} ${off} ${on} ${flag}`;
}

function setMaybe(v: number): number {
  maybe = v * 10;
  note(`maybe${v}`);
  return v;
}

function setFlag(v: boolean): boolean {
  flag = !v;
  note(`flag${v}`);
  return v;
}

export function moduleThrows(): string {
  try {
    count += boom("t");
  } catch (e) {
    note((e as Error).message);
  }
  return `${count}`;
}

export function locals(): string {
  let s = "a";
  let n = 1;
  let m = 1;

  s += s = "b";
  n += n = 10;
  m += m++;
  return `${s} ${n} ${m}`;
}

export function captured(): string {
  let s = "a";
  let n = 1;
  const grow = (t: string): string => {
    s = `${s}!`;
    n = n + 100;
    return t;
  };

  s += grow("x");
  n *= grow("y").length + 1;
  return `${s} ${n}`;
}

type Box = { n: number; s: string };

let shared: Box = { n: 0, s: "shared" };
let items = [1, 2, 3];

function replace(): number {
  shared = { n: -1, s: "replaced" };
  items = [7, 8, 9];
  note("replace");
  return 5;
}

/** The object a target names is the one before the right side runs. */
export function replaced(): string {
  const first = shared;

  shared.n = replace();

  const second = shared;

  shared.n += replace();

  const xs = items;

  items[0] = replace();
  return `${first.n} ${second.n} ${shared.n} ${xs.join(",")} ${items.join(",")}`;
}

function pick(box: Box, tag: string): Box {
  note(tag);
  return box;
}

function mutate(box: Box): number {
  box.n = 50;
  box.s = "changed";
  note("mutate");
  return 1;
}

export function fields(): string {
  const box: Box = { n: 1, s: "a" };

  const seen: number[] = [];

  box.n += mutate(box);
  seen.push(box.n);
  box.s += `${mutate(box)}`;
  seen.push(box.n);
  pick(box, "p").n %= 7;
  seen.push(box.n);
  pick(box, "q").n++;
  return `${seen.join(",")} ${box.n} ${box.s}`;
}

export function elements(): string {
  const xs = [1, 2, 3];
  const grow = (): number => {
    xs[0] = 100;
    note("grow");
    return 1;
  };

  xs[0]! += grow();
  note(`${xs[0]}`);
  xs[index(1)]! += index(5);
  xs[index(2)]! *= 3;
  xs[index(1)]!++;
  --xs[index(2)]!;
  return xs.join(",");
}

export function entries(): string {
  const counts: Record<string, number> = { a: 1, b: 2 };
  const key = (k: string): string => {
    note(k);
    return k;
  };
  const clobber = (): number => {
    counts["a"] = 40;
    note("clobber");
    return 2;
  };

  counts["a"]! += clobber();
  counts[key("b")]! -= clobber();
  return `${counts["a"]} ${counts["b"]}`;
}

export function elementThrows(): string {
  const xs = [1, 2, 3];

  try {
    xs[index(1)]! += boom("rhs");
  } catch (e) {
    note((e as Error).message);
  }

  try {
    xs[boom("key")]! += index(9);
  } catch (e) {
    note((e as Error).message);
  }
  return xs.join(",");
}

class Counter {
  total = 0;

  step(): number {
    this.total = 100;
    note("step");
    return 1;
  }

  add(): number {
    this.total += this.step();
    return this.total;
  }
}

export function members(): number {
  return new Counter().add();
}
