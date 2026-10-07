import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { programFacts, stepsOf } from "../../src/analysis/index.ts";
import { createLucentProgram } from "../../src/program.ts";
import { facts, one, unit, write } from "./fixture.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

/** The texts of a cause path. */
const texts = (c: Parameters<typeof stepsOf>[0] | undefined) =>
  c ? stepsOf(c).map((s) => s.text) : [];

const PURE = {
  reads: "none",
  writes: "none",
  allocates: false,
  throws: "no",
  suspends: false,
  callbacks: "none",
  affinity: "any",
  native: "none",
};

describe("effect summaries", () => {
  it("proves arithmetic on parameters pure", () => {
    const f = one("export function add(a: number, b: number): number {\n  return a * b + 1;\n}\n");

    expect(f.effects(unit(f, "m.add"))).toEqual(PURE);
  });

  it("reads a let and a const holding an object as module state, not a const number", () => {
    const f = one(`let count = 0;
const limit = 10;
const table: readonly number[] = [1, 2];
export function a(): number {
  return count;
}
export function b(): number {
  return limit;
}
export function c(): number {
  return table.length;
}
`);

    expect(f.effects(unit(f, "m.a")).reads).toBe("module");
    expect(f.effects(unit(f, "m.b"))).toEqual(PURE);
    expect([...f.summary(unit(f, "m.c")).reads.vars.keys()]).toEqual(["m.table"]);
    expect(texts(f.summary(unit(f, "m.c")).reads.vars.get("m.table"))).toEqual([
      "reads module state `table`, a const reference to a mutable object (declared at m.lucent.ts:3:7)",
    ]);
  });

  it("follows calls transitively and keeps the path", () => {
    const f = one(`const cache = new Map<string, number>();
function lookup(k: string): number {
  return cache.get(k) ?? 0;
}
function decode(k: string): number {
  return lookup(k) * 2;
}
export function run(k: string): number {
  return decode(k) + 1;
}
`);
    const cause = f.summary(unit(f, "m.run")).reads.vars.get("m.cache")!;

    expect(stepsOf(cause).map((s) => [s.unit, s.text, `${s.at.line}:${s.at.column}`])).toEqual([
      ["run", "calls `decode`", "9:10"],
      ["decode", "calls `lookup`", "6:10"],
      [
        "lookup",
        "reads module state `cache`, a const reference to a mutable object (declared at m.lucent.ts:1:7)",
        "3:10",
      ],
    ]);
  });

  it("reaches a fixed point through recursion", () => {
    const f = one(`let depth = 0;
function even(n: number): boolean {
  return n === 0 ? true : odd(n - 1);
}
function odd(n: number): boolean {
  depth++;
  return n === 0 ? false : even(n - 1);
}
export function pure(n: number): number {
  return n <= 1 ? 1 : n * pure(n - 1);
}
export function parity(n: number): boolean {
  return even(n);
}
`);

    expect(f.effects(unit(f, "m.even")).writes).toBe("module");
    expect(f.effects(unit(f, "m.parity")).writes).toBe("module");
    expect(texts(f.summary(unit(f, "m.even")).writes.vars.get("m.depth"))).toEqual([
      "calls `odd`",
      "assigns module state `depth`",
    ]);
    expect(f.effects(unit(f, "m.pure"))).toEqual(PURE);
  });

  it("writes module state it mutates, directly, through aliases and through callees", () => {
    const f = one(`const items: number[] = [];
export function add(x: number): void {
  items.push(x);
}
export function alias(x: number): void {
  const xs = items;
  xs[0] = x;
}
export function local(x: number): number {
  const xs: number[] = [];
  xs.push(x);
  return xs.length;
}
function fill(xs: number[]): void {
  xs.push(1);
}
export function both(): void {
  fill(items);
}
`);
    const writes = (id: string) => [...f.summary(unit(f, id)).writes.vars.keys()];

    expect(writes("m.add")).toEqual(["m.items"]);
    expect(writes("m.alias")).toEqual(["m.items"]);
    expect(writes("m.local")).toEqual([]);
    expect(f.summary(unit(f, "m.local")).mutates).toBeUndefined();
    // Its caller's object: the caller knows which.
    expect(writes("m.fill")).toEqual([]);
    expect(f.summary(unit(f, "m.fill")).mutates).toBeDefined();
    expect(writes("m.both")).toEqual(["m.items"]);
  });

  it("joins the closures a unit runs, and the callbacks library functions call", () => {
    const f = one(`let total = 0;
export function sum(xs: number[]): number {
  xs.forEach((x) => {
    total += x;
  });
  return total;
}
export function local(): number {
  const bump = () => total++;
  bump();
  return 0;
}
`);

    expect(f.effects(unit(f, "m.sum"))).toMatchObject({ writes: "module", callbacks: "known" });
    expect(f.effects(unit(f, "m.local"))).toMatchObject({ writes: "module", callbacks: "known" });
  });

  it("binds the functions a caller passes to the parameters its callee calls", () => {
    const f = one(`let hits = 0;
function apply(f: () => void): void {
  f();
}
function count(): void {
  hits++;
}
export function viaDeclared(): void {
  apply(count);
}
export function viaClosure(): void {
  apply(() => {
    hits++;
  });
}
export function forward(g: () => void): void {
  apply(g);
}
`);
    const apply = f.summary(unit(f, "m.apply"));

    expect(f.effects(unit(f, "m.apply"))).toMatchObject({ writes: "none", callbacks: "known" });
    expect([...apply.invokes.keys()].map((p) => p.name)).toEqual(["f"]);
    expect(texts(f.summary(unit(f, "m.viaDeclared")).writes.vars.get("m.hits"))).toEqual([
      "passes `count` to `apply`, which calls it",
      "assigns module state `hits`",
    ]);
    expect(f.effects(unit(f, "m.viaClosure")).writes).toBe("module");
    expect(f.effects(unit(f, "m.forward"))).toMatchObject({ writes: "none", callbacks: "known" });
    expect([...f.summary(unit(f, "m.forward")).invokes.keys()].map((p) => p.name)).toEqual(["g"]);
  });

  it("keeps calls of values it cannot follow unknown", () => {
    const f = one(`const handlers: (() => void)[] = [];
export function fire(): void {
  for (const h of handlers) h();
}
`);

    expect(f.effects(unit(f, "m.fire"))).toMatchObject({
      reads: "unknown",
      writes: "unknown",
      callbacks: "unknown",
      affinity: "unknown",
      native: "unknown",
    });
  });

  it("dispatches method calls to overrides, and runs getters, setters and construction", () => {
    const f = one(`let log = 0;
class Base {
  speak(): number {
    return 1;
  }
}
class Loud extends Base {
  override speak(): number {
    log++;
    return 2;
  }
}
export function talk(b: Base): number {
  return b.speak();
}
class Box {
  seen = log;
  get value(): number {
    return log;
  }
  set value(x: number) {
    log = x;
  }
}
export function make(): Box {
  return new Box();
}
export function get(b: Box): number {
  return b.value;
}
export function set(b: Box): void {
  b.value = 3;
}
void Loud;
`);

    expect(texts(f.summary(unit(f, "m.talk")).writes.vars.get("m.log"))).toEqual([
      "calls `b.speak` (`Loud.speak`)",
      "assigns module state `log`",
    ]);
    expect(f.effects(unit(f, "m.make")).reads).toBe("module");
    expect(f.effects(unit(f, "m.get"))).toMatchObject({ reads: "module", writes: "none" });
    expect(f.effects(unit(f, "m.set")).writes).toBe("module");
  });

  it("dispatches interface members to the classes that implement them", () => {
    const f = one(`let spoken = 0;
interface Pet {
  readonly kind: string;
  speak(): string;
}
class Cat implements Pet {
  get kind(): string {
    spoken++;
    return "cat";
  }
  speak(): string {
    return "meow";
  }
}
class Lion extends Cat {
  override speak(): string {
    spoken++;
    return "roar";
  }
}
export function talk(p: Pet): string {
  return p.speak();
}
export function kind(p: Pet): string {
  return p.kind;
}
void Lion;
`);

    expect(texts(f.summary(unit(f, "m.talk")).writes.vars.get("m.spoken"))).toEqual([
      "calls `p.speak` (`Lion.speak`)",
      "assigns module state `spoken`",
    ]);
    expect(f.effects(unit(f, "m.kind"))).toMatchObject({ writes: "module", callbacks: "none" });
  });

  it("runs the iterators it iterates and the promise executors it constructs", () => {
    const f = one(`let steps = 0;
function* count(): Generator<number> {
  steps++;
  yield 1;
}
export function direct(): number {
  let t = 0;
  for (const x of count()) t += x;
  return t;
}
export function given(xs: Iterable<number>): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}
export function arrays(xs: number[]): number {
  let t = 0;
  for (const x of [...xs]) t += x;
  return t;
}
export function settled(): Promise<number> {
  return new Promise((resolve) => resolve(1));
}
`);

    expect(f.effects(unit(f, "m.direct"))).toMatchObject({ reads: "module", writes: "module" });
    expect(texts(f.summary(unit(f, "m.given")).reads.unknown)).toEqual([
      "iterates `xs`, an iterator whose code is not known",
    ]);
    expect(f.effects(unit(f, "m.arrays"))).toMatchObject({ reads: "none", callbacks: "none" });
    expect(f.effects(unit(f, "m.settled")).callbacks).toBe("known");
    expect(f.summary(unit(f, "m.settled")).schedules).toBeDefined();
  });

  it("treats library members it does not know as unknown code", () => {
    const f = one(`export function run(f: (x: number) => number): number {
  return f.call(undefined, 1);
}
`);

    expect(f.effects(unit(f, "m.run"))).toMatchObject({ reads: "unknown", callbacks: "unknown" });
  });

  it("knows the conversions the compiler lowers: BigInt, valueOf and toString", () => {
    const f = one(`class Point {}
export function big(n: number, text: string): string {
  const b = BigInt(n) + BigInt(text);
  return BigInt.asIntN(64, b).toString(16) + BigInt.asUintN(8, b.valueOf());
}
export function scalars(n: number, yes: boolean): number {
  return n.valueOf() + (yes.valueOf() ? 1 : 0);
}
export function texts(xs: readonly number[], bytes: Uint8Array, p: Point): string {
  return [1].toString() + xs.toString() + bytes.toString() + p.toString() + big.toString();
}
`);

    const names = ["big", "scalars", "texts"];
    const known = (name: string) => {
      const { reads, writes, callbacks } = f.effects(unit(f, `m.${name}`));

      return { reads, writes, callbacks };
    };

    expect(Object.fromEntries(names.map((n) => [n, known(n)]))).toEqual(
      Object.fromEntries(
        names.map((n) => [n, { reads: "none", writes: "none", callbacks: "none" }]),
      ),
    );
  });

  it("records throwing, allocation, suspension and asynchronous work", () => {
    const f = one(`import { delay } from "lucent:core";
export function fails(): never {
  throw new Error("no");
}
export function caller(): void {
  fails();
}
export function present(x: number | undefined): number {
  return x!;
}
export async function waits(): Promise<number> {
  await delay(1);
  return 1;
}
export function starts(): void {
  void waits();
}
`);

    expect(f.effects(unit(f, "m.fails"))).toMatchObject({ throws: "yes", allocates: true });
    expect(f.effects(unit(f, "m.caller")).throws).toBe("yes");
    expect(f.effects(unit(f, "m.present")).throws).toBe("yes");
    expect(f.effects(unit(f, "m.waits"))).toMatchObject({
      suspends: true,
      reads: "none",
      native: "none",
    });
    expect(f.effects(unit(f, "m.starts")).suspends).toBe(false);
    expect(f.summary(unit(f, "m.starts")).schedules?.text).toBe("calls `waits`, which is async");
  });

  it("takes native facts from binding plans", () => {
    const f = one(`import { Clock, Disk, Sensor, View } from "./native";
export function title(v: View): void {
  v.setTitle("x");
}
export function read(): string {
  return Disk.read("/a");
}
export function sensed(s: Sensor): number {
  return s.value();
}
export function time(): number {
  return Clock.now();
}
`);

    expect(f.effects(unit(f, "m.title"))).toMatchObject({ affinity: "main", native: "known" });
    expect(texts(f.summary(unit(f, "m.title")).affinity.main)).toEqual([
      "calls `View.setTitle`, which runs on the main thread only",
    ]);
    expect(f.effects(unit(f, "m.read")).affinity).toBe("unknown");
    expect(f.summary(unit(f, "m.read")).affinity.worker).toBeDefined();
    expect(f.summary(unit(f, "m.read")).blocking.yes).toBeDefined();
    expect(f.effects(unit(f, "m.sensed")).affinity).toBe("unknown");
    expect(f.effects(unit(f, "m.time"))).toMatchObject({ affinity: "any", native: "known" });
  });

  it("joins callbacks native code runs during a call, and what it may call back at any call", () => {
    const f = one(`import { View } from "./native";
let taps = 0;
export function listen(v: View): void {
  v.onTap(() => {
    taps++;
  });
}
export function poke(v: View): void {
  v.setTitle("y");
}
export function visit(v: View): number {
  let n = 0;
  v.each((x) => {
    n += x;
  });
  return n;
}
export function quiet(x: number): number {
  return x;
}
`);

    // Code called back runs in the context its glue enters: not `poke`'s own writes.
    expect(f.summary(unit(f, "m.poke")).writes.vars.has("m.taps")).toBe(false);
    expect(f.effects(unit(f, "m.poke")).writes).toBe("module");
    expect(texts(f.summary(unit(f, "m.poke")).calledBack.writes.get("m.taps"))).toEqual([
      "calls `View.setTitle`, which may call back `the closure in listen`",
      "assigns module state `taps`",
    ]);
    expect(f.effects(unit(f, "m.visit")).callbacks).toBe("known");
    expect(f.effects(unit(f, "m.quiet"))).toEqual(PURE);
  });

  it("leaves out code for other platforms", () => {
    const [file] = write({
      m: `import { PLATFORM } from "lucent:platform";
let iosHits = 0;
let androidHits = 0;
export function run(): void {
  if (PLATFORM === "ios") iosHits++;
  else androidHits++;
}
`,
    });
    const ios = programFacts(createLucentProgram([file!], undefined, "ios"));
    const host = programFacts(createLucentProgram([file!]));

    expect([...ios.summary(ios.byId("m.run")!).writes.vars.keys()]).toEqual(["m.iosHits"]);
    expect([...host.summary(host.byId("m.run")!).writes.vars.keys()]).toEqual([]);
    expect(host.effects(host.byId("m.run")!).throws).toBe("yes");
  });

  it("follows calls across modules", () => {
    const f = facts({
      store:
        "export const names: string[] = [];\nexport function remember(n: string): void {\n  names.push(n);\n}\n",
      m: 'import { remember } from "./store.lucent";\nexport function greet(): void {\n  remember("ada");\n}\n',
    });

    expect([...f.summary(unit(f, "m.greet")).writes.vars.keys()]).toEqual(["store.names"]);
  });

  it("is the same on every build, and computed once per program", () => {
    const source = fs.readFileSync(path.join(CASES, "closures.lucent.ts"), "utf8");

    expect(one(source).dump()).toBe(one(source).dump());

    const lp = createLucentProgram(write({ m: source }));

    expect(programFacts(lp)).toBe(programFacts(lp));
  });

  it("summarizes every e2e case", () => {
    const files = fs.readdirSync(CASES).filter((f) => f.endsWith(".lucent.ts"));

    for (const name of files) {
      const f = programFacts(createLucentProgram([path.join(CASES, name)]));

      expect(f.units.length, name).toBeGreaterThan(0);
      for (const u of f.units) expect(f.effects(u), u.id).toBeDefined();
    }
  });
});

describe("posted calls", () => {
  const source = `let taps = 0;
function count(): number {
  taps++;
  return taps;
}
type Props = { onTap: (n: number) => void; onDrag?: (x: number) => void };
export function tap(props: Props, n: number): void {
  props.onTap(n + 1);
  props.onDrag?.(n);
}
export function counted(props: Props): void {
  props.onTap(count());
}
`;
  const posts = (call: ts.CallExpression) =>
    /^props\.on(Tap|Drag)$/.test(call.expression.getText());

  it("are unknown code unless the caller says they post", () => {
    const f = one(source);

    expect(f.effects(unit(f, "m.tap"))).toMatchObject({ reads: "unknown", callbacks: "unknown" });
  });

  it("run none of the callee's code: they only copy their arguments", () => {
    const f = facts({ m: source }, { posts });
    const tap = unit(f, "m.tap");

    expect(f.effects(tap)).toMatchObject({
      reads: "none",
      writes: "none",
      callbacks: "none",
      throws: "no",
      allocates: true,
      native: "none",
    });
    expect(f.summary(tap).allocates.yes?.text).toBe("posts a call of `props.onTap`");
    expect(f.check(tap, "main")).toEqual([]);
  });

  it("still evaluate their arguments here", () => {
    const f = facts({ m: source }, { posts });
    const [v, ...rest] = f.check(unit(f, "m.counted"), "main");

    expect(rest).toEqual([]);
    expect(v).toMatchObject({ rule: "module-state" });
    expect(v!.message).toMatch(/^`counted` cannot run on the main thread: it calls `count`/);
  });
});

describe("checked conversions and throwing operators", () => {
  it("throw where JavaScript's code would not, and nowhere else", () => {
    const f = one(`export function asNum(x: string | number): number {
  return x as number;
}
export function widen(x: number): number | string {
  return x as number | string;
}
export function constant(): readonly number[] {
  return [1, 2] as const;
}
export function div(a: bigint, b: bigint): bigint {
  return a / b;
}
export function mod(a: bigint, b: bigint): bigint {
  return a % b;
}
export function pow(a: bigint, b: bigint): bigint {
  return a ** b;
}
export function divInPlace(a: bigint, b: bigint): bigint {
  a /= b;
  return a;
}
export function times(a: bigint, b: bigint): bigint {
  return a * b;
}
export function numbers(a: number, b: number): number {
  return (a / b) % b;
}
export function element(xs: number[], i: number): number | undefined {
  return xs[i];
}
export function present(xs: number[]): number {
  if (xs[0] !== undefined) return xs[0];
  return 0;
}
`);
    const throws = (name: string) => f.effects(unit(f, `m.${name}`)).throws;

    for (const name of ["asNum", "div", "mod", "pow", "divInPlace", "present"])
      expect(throws(name), name).toBe("yes");

    for (const name of ["widen", "constant", "times", "numbers", "element"])
      expect(throws(name), name).toBe("no");
  });
});

