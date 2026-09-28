import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { programFacts, type ProgramFacts, type Unit } from "../../src/analysis/index.ts";
import { createLucentProgram } from "../../src/program.ts";
import { facts, one, unit } from "./fixture.ts";

const xcode = process.platform === "darwin" && sdkAvailable("ios");

/** A unit's parameter's (or local's) symbol, by name. */
function symbol(f: ProgramFacts & { checker: ts.TypeChecker }, u: Unit, name: string): ts.Symbol {
  let found: ts.Symbol | undefined;
  const visit = (n: ts.Node): void => {
    if (!found && ts.isIdentifier(n) && n.text === name && ts.isVariableDeclaration(n.parent))
      found = f.checker.getSymbolAtLocation(n);
    if (!found && ts.isIdentifier(n) && n.text === name && ts.isParameter(n.parent))
      found = f.checker.getSymbolAtLocation(n);
    ts.forEachChild(n, visit);
  };

  visit(u.node);

  if (!found) throw new Error(`no ${name} in ${u.id}`);

  return found;
}

/** The type of a function's parameter. */
function paramType(f: ProgramFacts & { checker: ts.TypeChecker }, u: Unit, index: number): ts.Type {
  return f.checker.getTypeAtLocation(u.params[index]!);
}

/** The closure of `parent` declared as `const name = …`. */
function closure(f: ProgramFacts, parent: string, name: string): Unit {
  const u = f.units.find((x) => x.parent?.id === parent && x.display === name);

  if (!u) throw new Error(`no closure ${name} in ${parent}`);

  return u;
}

describe("compute task checks", () => {
  it("accepts pure code and the library calls and closures it runs", () => {
    const f = one(`export function edges(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < bytes.length; i++) {
    if (Math.abs(bytes[i]! - bytes[i - 1]!) > 40) out.push(i);
  }
  return out.map((x) => x * 2);
}
`);

    expect(f.check(unit(f, "m.edges"), "task")).toEqual([]);
  });

  it("refuses a const reference to a mutable module array, with the path", () => {
    const f = one(`const table: readonly number[] = [1, 2, 3];
const scale = 2;
function weigh(x: number): number {
  return x * (table[0] ?? 1);
}
export function run(x: number): number {
  return weigh(x);
}
export function double(x: number): number {
  return x * scale;
}
`);
    const [v, ...rest] = f.check(unit(f, "m.run"), "task");

    expect(rest).toEqual([]);
    expect(v).toMatchObject({ rule: "module-state" });
    expect(v!.message).toBe(
      "`run` cannot run in a compute task: it calls `weigh` (m.lucent.ts:7:10), which reads module state `table`, a const reference to a mutable object (declared at m.lucent.ts:1:7) (m.lucent.ts:4:15).",
    );
    expect(v!.fix).toMatch(/input/);
    expect(f.check(unit(f, "m.double"), "task")).toEqual([]);
  });

  it("refuses module constants a reload assigns again, but not literal ones", () => {
    const f = one(`const LIMIT = 40;
const NAME: string = "edge";
const NEG = -1;
const BIG = 10n;
const ON = true;
const TWICE = LIMIT * 2;
const add = (a: number, b: number) => a + b;
class Scale {
  static readonly FACTOR = 3;
  static readonly ROOT = Math.sqrt(2);
}
export function literals(x: number): string {
  return NAME + (x * LIMIT + NEG) + BIG + ON + Scale.FACTOR;
}
export function computed(x: number): number {
  return x * TWICE;
}
export function called(x: number): number {
  return add(x, 1);
}
export function field(x: number): number {
  return x * Scale.ROOT;
}
`);
    const [v, ...rest] = f.check(unit(f, "m.computed"), "task");

    expect(f.check(unit(f, "m.literals"), "task")).toEqual([]);
    expect(rest).toEqual([]);
    expect(v).toMatchObject({ rule: "module-constant" });
    expect(v!.message).toBe(
      "`computed` cannot run in a compute task: it reads module constant `TWICE`, which is not a literal: a reload of JavaScript assigns it again (declared at m.lucent.ts:6:7) (m.lucent.ts:16:14).",
    );
    expect(v!.fix).toMatch(/literal/);
    expect(f.check(unit(f, "m.called"), "task").map((x) => x.rule)).toEqual(["module-constant"]);
    expect(f.check(unit(f, "m.field"), "task").map((x) => x.rule)).toEqual(["module-constant"]);

    // The module's own thread reads them freely.
    for (const id of ["m.computed", "m.called", "m.field"])
      expect(f.check(unit(f, id), "main")).toEqual([]);
  });

  it("refuses main-thread and unknown native code reached indirectly", () => {
    const f = one(`import { Clock, Sensor, View } from "./native";
function paint(v: View): void {
  v.setTitle("x");
}
export function render(v: View): void {
  paint(v);
}
export function sample(s: Sensor): number {
  return s.value();
}
export function stamp(): number {
  return Clock.now();
}
`);
    const render = f.check(unit(f, "m.render"), "task");

    expect(render.map((v) => v.rule)).toEqual(["main-thread"]);
    expect(render[0]!.steps.map((s) => s.text)).toEqual([
      "calls `paint`",
      "calls `View.setTitle`, which runs on the main thread only",
    ]);
    expect(f.check(unit(f, "m.sample"), "task").map((v) => v.rule)).toEqual(["unknown-thread"]);
    expect(f.check(unit(f, "m.stamp"), "task")).toEqual([]);
  });

  it("refuses code it cannot see and asynchronous work", () => {
    const f = one(`import { delay } from "lucent:core";
const handlers: (() => void)[] = [];
export function fire(): void {
  for (const h of [...handlers]) h();
}
export async function later(): Promise<void> {
  await delay(1);
}
`);

    expect(f.check(unit(f, "m.fire"), "task").map((v) => v.rule)).toEqual([
      "module-state",
      "unknown-code",
    ]);
    expect(f.check(unit(f, "m.later"), "task").map((v) => v.rule)).toEqual(["asynchronous"]);
  });
});

describe("main thread checks", () => {
  it("refuses module state, worker and blocking native code; accepts main-thread code", () => {
    const f = one(`import { Disk, Sensor, View } from "./native";
let frames = 0;
export function tick(): number {
  return ++frames;
}
export function load(): string {
  return Disk.read("/a");
}
export function paint(v: View, s: Sensor): void {
  v.setTitle(String(s.value()));
}
`);

    expect(f.check(unit(f, "m.tick"), "main").map((v) => v.rule)).toEqual(["module-state"]);
    expect(f.check(unit(f, "m.load"), "main").map((v) => v.rule)).toEqual([
      "worker-thread",
      "blocking",
    ]);
    expect(f.check(unit(f, "m.paint"), "main")).toEqual([]);
  });
});

describe("re-entry", () => {
  /**
   * One module keeps callbacks the platform queues on the Lucent thread
   * (a monitor's handler, a delegate's requirement); another creates a
   * view on the main thread. Queued callbacks run as turns of their own,
   * never during a native call.
   */
  const MODULES = {
    watch: `import { Chooser, Monitor, type Answers } from "./native";
let online = false;
let onAnswer: (() => void) | undefined;
class Answer implements Answers {
  answered(): void {
    onAnswer?.();
  }
}
export function start(): void {
  new Monitor().watch((up) => {
    online = up;
  });
  const chooser = new Chooser();
  chooser.delegate = new Answer();
}
export function listen(f: () => void): void {
  onAnswer = f;
}
export function status(): boolean {
  return online;
}
`,
    card: `import { View } from "./native";
export function card(title: string): View {
  const v = new View();
  v.setTitle(title);
  return v;
}
`,
  };

  it("leaves out callbacks the platform queues: a view's setup runs on the main thread", () => {
    const f = facts(MODULES);

    expect(f.check(unit(f, "card.card"), "main").map((v) => v.message)).toEqual([]);
  });

  /**
   * Module code the platform calls back while a native call runs (a
   * callback, an override of a platform class) runs in the legacy module
   * context: its glue enters it holding the Lucent lock. What it does is
   * that context's, not the main thread's or a task's: they are not refused
   * for it. The call's effects still include it.
   */
  const CALLED_BACK = {
    tap: `import { View } from "./native";
let taps = 0;
export function listen(v: View): void {
  v.onTap(() => {
    taps++;
  });
}
`,
    greet: `import { Controller } from "./native";
let shown = 0;
class Greeting extends Controller {
  constructor(private readonly done: () => void) {
    super();
  }
  appeared(): void {
    shown++;
    this.done();
  }
}
export function show(done: () => void): Controller {
  return new Greeting(() => done());
}
`,
  };

  it("leaves what code called back does to the context it runs in", () => {
    const f = facts({ ...MODULES, ...CALLED_BACK });

    expect(f.check(unit(f, "card.card"), "main").map((v) => v.message)).toEqual([]);
    // The override calls a function value no one here binds: anything may happen during the call.
    expect(f.effects(unit(f, "card.card"))).toMatchObject({
      reads: "unknown",
      writes: "unknown",
      callbacks: "unknown",
    });
  });

  it("does not refuse a compute task for an override of a platform class", () => {
    const f = facts({
      ...MODULES,
      ...CALLED_BACK,
      time: `import { Clock } from "./native";
export function stamp(x: number): number {
  return x + Clock.now();
}
`,
    });

    expect(f.check(unit(f, "time.stamp"), "task").map((v) => v.message)).toEqual([]);
  });

  it("still refuses what the unit does in its own context", () => {
    const f = facts({
      ...MODULES,
      ...CALLED_BACK,
      own: `import { View } from "./native";
let titles = 0;
export function titled(title: string): View {
  const v = new View();
  v.setTitle(title);
  titles++;
  return v;
}
`,
    });

    expect(f.check(unit(f, "own.titled"), "main").map((v) => v.rule)).toEqual(["module-state"]);
  });

  it("leaves out queued callbacks for a compute task's native calls too", () => {
    const f = facts({
      ...MODULES,
      time: `import { Clock } from "./native";
export function stamp(x: number): number {
  return x + Clock.now();
}
`,
    });

    expect(f.check(unit(f, "time.stamp"), "task").map((v) => v.message)).toEqual([]);
  });

  it("leaves out compute tasks: native code never runs them", () => {
    const f = facts({
      ...MODULES,
      work: `import { compute } from "lucent:core";
let runs = 0;
function heavy(x: number): number {
  return x * 2 + runs;
}
export function count(): number {
  return ++runs;
}
export function run(x: number): Promise<number> {
  return compute(heavy, x);
}
`,
    });

    expect(f.check(unit(f, "card.card"), "main").map((v) => v.message)).toEqual([]);
  });
});

describe("captures", () => {
  it("lists what a closure captures", () => {
    const f = one(`export function counter(start: number): () => number {
  let n = start;
  const step = 1;
  const next = () => (n += step);
  return next;
}
`);

    expect(
      f.captures(closure(f, "m.counter", "next")).map((c) => [c.name, c.declaredIn.id]),
    ).toEqual([
      ["n", "m.counter"],
      ["step", "m.counter"],
    ]);
  });

  it("refuses an indirect native-view capture, naming the path", () => {
    const f = one(`import { View } from "./native";
export function schedule(view: View, n: number): number {
  const opts = { view, n };
  const draw = () => opts.view.setTitle(String(n));
  const task = () => {
    draw();
    return opts.n;
  };
  return task();
}
`);
    const task = closure(f, "m.schedule", "task");
    const found = f.checkCaptures(task, "task");

    expect(found.map((v) => v.message)).toEqual([
      "`task` cannot run in a compute task: it captures `draw` (declared at m.lucent.ts:4:9), a closure (m.lucent.ts:6:5), which calls `View.setTitle`, which runs on the main thread only (m.lucent.ts:4:22).",
      "`task` cannot run in a compute task: it captures `draw` (declared at m.lucent.ts:4:9), a closure (m.lucent.ts:6:5), which captures `opts` (declared at m.lucent.ts:3:9), whose `view` is a main-thread native object (View) (m.lucent.ts:4:22).",
      "`task` cannot run in a compute task: it captures `opts` (declared at m.lucent.ts:3:9), whose `view` is a main-thread native object (View) (m.lucent.ts:7:12).",
    ]);
    expect(found.map((v) => v.rule)).toEqual([
      "main-thread",
      "not-transferable",
      "not-transferable",
    ]);
    // Its own code runs the main-thread call too.
    expect(f.check(task, "task").map((v) => v.rule)).toEqual(["main-thread"]);
  });

  it("refuses captured module state through an alias", () => {
    const f = one(`const cache: number[] = [];
export function size(): () => number {
  const c = cache;
  const count = () => c.length;
  return count;
}
`);
    const count = closure(f, "m.size", "count");

    expect(f.checkCaptures(count, "task").map((v) => v.message)).toEqual([
      "`count` cannot run in a compute task: it captures `c` (declared at m.lucent.ts:3:9), which may be module state `cache`, a const reference to a mutable object (m.lucent.ts:4:23).",
    ]);
    expect(f.effects(count).reads).toBe("module");
  });
});

describe("transfer", () => {
  it("accepts plain data and names what cannot cross", () => {
    const f = one(`import { Clock, Sensor, View } from "./native";
type Tree = { label: string; kids: Tree[] };
type Plain = { xs: number[]; when: Date; bytes: Uint8Array; tags: Map<string, number[]>; tree: Tree };
type Bad = { items: number[]; view: View };
class Holder {
  count = 0;
  constructor(readonly sensor: Sensor) {}
  describe(): string {
    return "holder";
  }
}
export function take(a: Plain, b: Bad, c: () => void, d: Promise<number>, e: Clock, g: Holder, h: View[]): void {
  void [a, b, c, d, e, g, h];
}
`);
    const take = unit(f, "m.take");
    const problem = (i: number, name: string) => f.transfer(paramType(f, take, i), name);

    expect(problem(0, "a")).toBeUndefined();
    expect(problem(1, "b")).toEqual({
      path: "b.view",
      reason: "a main-thread native object (View)",
    });
    expect(problem(2, "c")).toEqual({ path: "c", reason: "a function" });
    expect(problem(3, "d")?.reason).toMatch(/^a promise/);
    expect(problem(4, "e")).toBeUndefined();
    expect(problem(5, "g")).toEqual({
      path: "g.sensor",
      reason: "a native object with no known thread requirement (Sensor)",
    });
    expect(problem(6, "h")).toEqual({ path: "h[i]", reason: "a main-thread native object (View)" });
  });
});

describe("escapes", () => {
  const source = `import { delay } from "lucent:core";
const kept: Uint8Array[] = [];
export function keep(bytes: Uint8Array): Uint8Array {
  return bytes;
}
export function store(bytes: Uint8Array): void {
  kept.push(bytes);
}
export function field(o: { b?: Uint8Array }, bytes: Uint8Array): void {
  o.b = bytes;
}
export function capture(bytes: Uint8Array): () => number {
  return () => bytes.length;
}
export function view(bytes: Uint8Array): Uint8Array {
  const v = bytes.subarray(1);
  return v;
}
export function copy(bytes: Uint8Array): Uint8Array {
  return bytes.slice(1);
}
export function reads(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i]!;
  const first = () => bytes[0]!;
  const local: Uint8Array[] = [bytes];
  return total + first() + local.length;
}
function keeper(b: Uint8Array): void {
  kept.push(b);
}
export function indirect(bytes: Uint8Array): void {
  keeper(bytes);
}
export async function later(bytes: Uint8Array): Promise<number> {
  await delay(1);
  return bytes.length;
}
export function arrows(bytes: Uint8Array): number {
  const give = (b: Uint8Array) => b;
  const size = (b: Uint8Array) => b.length;
  return give(bytes).length + size(bytes);
}
`;

  it("finds how a borrowed value could outlive its scope", () => {
    const f = one(source);
    const kinds = (id: string) => f.escapes(symbol(f, unit(f, id), "bytes")).map((e) => e.kind);

    expect(kinds("m.keep")).toEqual(["returned"]);
    expect(kinds("m.store")).toEqual(["stored"]);
    expect(kinds("m.field")).toEqual(["stored"]);
    expect(kinds("m.capture")).toEqual(["returned"]);
    expect(kinds("m.view")).toEqual(["returned"]);
    expect(kinds("m.indirect")).toEqual(["passed"]);
    expect(kinds("m.later")).toEqual(["await"]);
  });

  it("finds what an arrow's expression body returns", () => {
    const f = one(source);
    const kinds = (name: string) =>
      f.escapes(symbol(f, closure(f, "m.arrows", name), "b")).map((e) => e.kind);

    expect(kinds("give")).toEqual(["returned"]);
    expect(kinds("size")).toEqual([]);
  });

  it("accepts reads, copies and local uses", () => {
    const f = one(source);

    expect(f.escapes(symbol(f, unit(f, "m.copy"), "bytes"))).toEqual([]);
    expect(f.escapes(symbol(f, unit(f, "m.reads"), "bytes"))).toEqual([]);
  });

  it("explains the path", () => {
    const f = one(source);
    const [capture] = f.escapes(symbol(f, unit(f, "m.capture"), "bytes"));
    const [indirect] = f.escapes(symbol(f, unit(f, "m.indirect"), "bytes"));

    expect(capture!.message).toBe(
      "`bytes` is captured by `the closure in capture` (m.lucent.ts:13:10), which is returned (m.lucent.ts:13:3)",
    );
    expect(indirect!.steps.map((s) => s.text)).toEqual([
      "is passed to `keeper`, which keeps it",
      "is kept by `Array.push` in `kept`, which is module state",
    ]);
  });
});

describe("owners", () => {
  it("finds the contexts that run each unit", () => {
    const f = one(`import { main } from "lucent:thread";
import { View } from "./native";
let hits = 0;
function helper(): void {
  hits++;
}
export function run(v: View): void {
  helper();
  void main(() => {
    v.setTitle("x");
    helper();
  });
}
export function greeter(): () => void {
  const greet = () => helper();
  return greet;
}
`);
    const owners = (u: Unit) => [...f.owners(u).keys()];
    const onMain = f.units.find((u) => u.parent?.id === "m.run")!;

    expect(owners(unit(f, "m.run"))).toEqual(["legacy-module"]);
    expect(owners(onMain)).toEqual(["main"]);
    // `greet` escapes (it is returned): any context may call it, and what it calls.
    expect(owners(unit(f, "m.helper"))).toEqual(["legacy-module", "main", "unknown"]);
    expect(owners(closure(f, "m.greeter", "greet"))).toEqual(["unknown"]);
    // What runs on the main thread there is not the caller's affinity, but its state is its effect.
    expect(f.effects(unit(f, "m.run"))).toMatchObject({ affinity: "any", writes: "module" });
  });

  it("makes callbacks native code keeps and methods it calls entries on their thread", () => {
    const f = one(`import { type Listener, View } from "./native";
let taps = 0;
export function listen(v: View): void {
  v.onTap(() => {
    taps++;
  });
}
export class Watcher implements Listener {
  changed(): void {
    taps++;
  }
}
`);
    const tapped = f.units.find((u) => u.parent?.id === "m.listen")!;

    expect([...f.owners(tapped).keys()]).toEqual(["main"]);
    expect([...f.owners(unit(f, "m.Watcher.changed")).keys()]).toEqual(["legacy-module", "main"]);
  });

  it("makes functions passed to compute task entries, not escaping values", () => {
    const f = one(`import { compute } from "lucent:core";
function inner(x: number): number {
  return x + 1;
}
function work(x: number): number {
  return inner(x) * 2;
}
export function run(x: number): Promise<number> {
  return compute(work, x);
}
`);
    const work = f.owners(unit(f, "m.work"));

    expect([...work.keys()]).toEqual(["task"]);
    expect(work.get("task")).toMatchObject({
      unit: unit(f, "m.run"),
      text: "is passed to `compute`, which runs it on a worker",
    });
    expect([...f.owners(unit(f, "m.inner")).keys()]).toEqual(["task"]);
  });
});

describe.skipIf(!xcode)("iOS SDK facts", () => {
  it("reads thread requirements from the binding plans", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-analysis-ios-"));
    const shared = path.join(dir, "m.lucent.ts");
    const ios = path.join(dir, "m.ios.lucent.ts");

    fs.writeFileSync(shared, "export declare function paint(): number;\n");
    fs.writeFileSync(
      ios,
      `import { UIView } from "lucent:ios/UIKit";
function make(): UIView {
  return new UIView();
}
export function paint(): number {
  make().setNeedsLayout();
  return 0;
}
`,
    );

    const lp = createLucentProgram([ios], undefined, "ios", { references: [shared] });

    expect(lp.diagnostics).toEqual([]);

    const f = programFacts(lp);
    const paint = f.byId("m.paint")!;
    const [v] = f.check(paint, "task");

    expect(v).toMatchObject({ rule: "main-thread" });
    expect(v!.message).toMatch(/UIView/);
    expect(f.check(paint, "main")).toEqual([]);
    expect(
      f.transfer(
        lp.checker.getReturnTypeOfSignature(
          lp.checker.getSignatureFromDeclaration(f.byId("m.make")!.node as ts.FunctionDeclaration)!,
        ),
        "view",
      ),
    ).toEqual({
      path: "view",
      reason: "a main-thread native object (UIView)",
    });
  });
});
