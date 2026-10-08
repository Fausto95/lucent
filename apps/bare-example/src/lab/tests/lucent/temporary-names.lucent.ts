// Locals named like the compiler's own temporaries (object literals'
// obj_N, loops' collN_ and iN_, a finally's fcN_ex, a spread push's pa,
// for…in's k and keys, a closure's per-iteration copy, `in`'s key_N):
// the generated code must keep each apart from the names it makes up.

class Link {
  prev?: Link;
  label = "link";
}

export function objects(): string {
  const obj_1 = new Link();
  const obj_2 = new Link();
  const obj_2_ = new Link();
  obj_2.label = "two";
  obj_2_.label = "two_";
  const o = { prev: obj_1, label: "lit" };
  const p = { prev: obj_2, label: "lit2" };
  const q = { prev: obj_2_, label: "lit3" };
  return `${o.prev.label} ${p.prev.label} ${q.prev.label} ${p.prev === obj_2}`;
}

export function loops(): string {
  const coll0_ = [9];
  const coll0_v = "v";
  const coll0_close = "close";
  const coll0_guard = "guard";
  const coll0_cps = "cps";
  const coll0_guard_ = "guard_";
  const i0_ = 100;
  const out: string[] = [];
  for (const c of "ab") out.push(`${c}${coll0_cps}`);
  for (const [k, v] of new Map([["m", 1]])) out.push(`${k}${v}${coll0_guard}${coll0_guard_}`);
  for (const x of [1, 2]) out.push(`${x}${coll0_v}${coll0_close}${i0_}${coll0_.length}`);
  return out.join(",");
}

function* gen(): Generator<number> {
  yield 1;
  yield 2;
}

export function iterators(): string {
  const coll0_v = 10;
  const coll0_close = 20;
  const coll1_v = 30;
  const coll1_close = 40;
  let s = "";
  for (const x of gen()) s += `${x + coll0_v + coll0_close + coll1_v + coll1_close};`;
  return s;
}

export function finals(): string {
  const fc0_ex = "pending";
  const fc0_ = 7;
  const fc0ex_ = "ex_";
  const log: string[] = [];
  try {
    log.push("body");
  } finally {
    log.push(`${fc0_ex}${fc0_}${fc0ex_}`);
  }
  return log.join(",");
}

export function pushes(): number {
  const pa = [1, 2];
  const xs: number[] = [0];
  xs.push(...pa);
  return xs.length * 10 + pa.length;
}

export function keysOf(): string {
  const k = ["a", "b", "c"];
  const keys: string[] = [];
  const out: string[] = [];
  for (const i in k) out.push(i);
  return `${out.join(",")} ${keys.length}`;
}

export function copies(): number[] {
  const fns: (() => number)[] = [];
  const i_it = 1000;
  for (let i = 0; i < 3; i++) fns.push(() => i + i_it);
  return fns.map((f) => f());
}

export function keyed(r: Record<string, number>): string {
  const key_1 = "zz";
  const key_2 = "a";
  const x_1 = 1;
  const v_1 = 3;
  const u_1 = 4;
  const src_1 = 5;
  const u_ = 6;
  const r_ = 7;
  return `${"a" in r} ${key_1 in r} ${key_2 in r} ${x_1}${v_1}${u_1}${src_1}${u_}${r_}`;
}
