import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { createRequire } from "node:module";
import { compile, coreJsPath } from "../src/index.ts";

const xcode = process.platform === "darwin" && sdkAvailable("ios");

/** Compiles modules (name → source) together; the result and each file's text, whitespace collapsed. */
function build(modules: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compute-"));
  const files = Object.entries(modules).map(([name, source]) => {
    const file = path.join(dir, `${name}.lucent.ts`);

    fs.writeFileSync(file, source);
    return file;
  });
  const r = compile(files);
  const text = (name: string) => (r.files.get(name) ?? "").replace(/\s+/g, " ");

  return { r, text };
}

/** The diagnostics of a one-module program `m`, as code and message. */
function refusals(source: string) {
  return build({ m: source }).r.diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    line: d.line,
  }));
}

const EDGES = `import { compute } from "lucent:core";

type Point = { x: number; y: number; tags: string[] };

function edgePositions(bytes: Uint8Array): number[] {
  const positions: number[] = [];
  for (let i = 1; i < bytes.length; i++) {
    if (Math.abs(bytes[i]! - bytes[i - 1]!) > 40) positions.push(i);
  }
  return positions;
}

function spread(p: Point): number {
  let total = p.x + p.y;
  for (const t of p.tags) total += t.length;
  return total + edgePositions(new Uint8Array([0, 99])).length;
}

export async function edges(bytes: Uint8Array, signal?: AbortSignal): Promise<number[]> {
  return await compute(edgePositions, bytes, { signal });
}

export function total(p: Point): Promise<number> {
  return compute(spread, p);
}

export function plain(bytes: Uint8Array): number[] {
  return edgePositions(bytes);
}
`;

describe("compute lowering", () => {
  it("runs a task entry per function on the pool, with the module's scope", () => {
    const { r, text } = build({ m: EDGES });

    expect(r.diagnostics).toEqual([]);

    const unit = text("m_m.cpp");

    expect(unit).toContain("#include <lucent/compute.h>");
    expect(unit).toMatch(
      /static constexpr lucent::TaskEntry<std::tuple<lucent::Bytes>, lucent::Array<double>> \w+\{"m\.edgePositions", &\w+\};/,
    );
    expect(unit).toContain('"m.spread"');
    expect(unit).toContain("lucent::compute(");
    expect(unit).toContain("lucent::moduleScope()");
    // Only where it is used.
    expect(text("lucent_app.h")).not.toContain("compute.h");
    // The task and the options object are not values at run time.
    expect(text("lucent_app.h")).not.toContain("ComputeOptions");
    expect(unit).not.toContain("lucent::Fn<");
  });

  it("checks for cancellation at each iteration of the task's loops, and of what it calls", () => {
    const { text } = build({ m: EDGES });
    const unit = text("m_m.cpp");
    const variant = unit.slice(unit.indexOf("edgePositions_task_(lucent::Bytes"));
    const plain = unit.slice(unit.indexOf("edgePositions(lucent::Bytes"), unit.indexOf("spread("));

    expect(variant).toContain("task_.checkCancelled();");
    expect(plain).not.toContain("checkCancelled");
    // spread's variant calls edgePositions' variant.
    expect(unit).toMatch(/spread_task_\([^)]*lucent::TaskContext& task_\)/);
    expect(unit).toContain("edgePositions_task_(");
    expect(text("m_m.h")).toContain("namespace lucent { class TaskContext; }");
  });

  it("copies structs and classes the input holds, keeping aliases", () => {
    const { r, text } = build({
      m: `import { compute } from "lucent:core";
type Node = { label: string; next?: Node };
class Counter {
  count = 0;
  constructor(readonly step: number) {}
  bump(): number {
    this.count += this.step;
    return this.count;
  }
}
function walk(n: Node): string {
  return n.label + (n.next?.label ?? "");
}
function twice(c: Counter): number {
  c.bump();
  return c.bump();
}
export function labels(): Promise<string> {
  const a: Node = { label: "a" };
  a.next = { label: "b", next: a };
  return compute(walk, a);
}
export function counts(): Promise<number> {
  return compute(twice, new Counter(2));
}
`,
    });

    expect(r.diagnostics).toEqual([]);
    expect(text("m_m.cpp")).toMatch(/struct Transport<lucent::Ref<lucent_app::\w+>>/);
    expect(text("m_m.cpp")).toContain("lucent::transportObject(");
    expect(text("m_m.cpp")).toMatch(/Transport<lucent::Ref<lucent_app::C_Counter>>/);
  });

  it("copies literal module constants into the code, which reads no module storage", () => {
    const { r, text } = build({
      config: `export const STEP = 7;
`,
      m: `import { compute } from "lucent:core";
import { STEP } from "./config.lucent.ts";
const LIMIT = 40;
const NEG = -1;
const NAME: string = "edge";
const BIG = 10n;
const ON = true;
class Box {
  static readonly MAX = 3;
  constructor(readonly w: number) {}
  area(): number {
    return this.w * Box.MAX;
  }
}
function label(n: number): string {
  const b = new Box(n);
  return NAME + (n * LIMIT + NEG + STEP) + BIG + ON + b.area();
}
export function run(n: number): Promise<string> {
  return compute(label, n);
}
`,
    });

    expect(r.diagnostics).toEqual([]);

    const unit = text("m_m.cpp");
    const init = unit.slice(unit.indexOf("m_m::init()"));
    const code = unit.replace(init.slice(0, init.indexOf("}") + 1), "");
    const variant = unit.slice(unit.indexOf("label_task_("));

    // Only the module's initialization touches the constants' storage.
    for (const storage of ["m_m::LIMIT", "m_m::NEG", "m_m::NAME", "m_m::BIG", "m_m::ON"]) {
      expect(init).toContain(storage);
      expect(code).not.toContain(storage);
    }

    expect(code).not.toContain("m_config::STEP");
    expect(code).not.toContain("C_Box::MAX");
    expect(variant).toContain('LUCENT_STR("edge")');
    expect(variant).toContain("40.0");
    expect(variant).toContain("7.0");
  });
});

describe("compute checks", () => {
  it("refuses a task that reads module state, naming the path", () => {
    const [d, ...rest] = refusals(`import { compute } from "lucent:core";
const table: number[] = [1, 2];
function weigh(x: number): number {
  return x * (table[0] ?? 1);
}
export function run(x: number): Promise<number> {
  return compute(weigh, x);
}
`);

    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "LUCENT3011", line: 7 });
    expect(d!.message).toBe(
      "`weigh` cannot run in a compute task: it reads module state `table`, a const reference to a mutable object (declared at m.lucent.ts:2:7) (m.lucent.ts:4:15).",
    );
  });

  it("accepts a task that converts with BigInt and toString", () => {
    expect(
      refusals(`import { compute } from "lucent:core";
function wide(n: number): string {
  return BigInt.asUintN(64, BigInt(n) * 3n).toString(16) + [n].toString();
}
export function run(n: number): Promise<string> {
  return compute(wide, n);
}
`),
    ).toEqual([]);
  });

  it("refuses a task that reads a module constant a reload assigns again", () => {
    const found = refusals(`import { compute } from "lucent:core";
const LIMIT = 40;
const TWICE = LIMIT * 2;
const add = (a: number, b: number) => a + b;
function scaled(x: number): number {
  return x * TWICE;
}
function summed(x: number): number {
  return add(x, LIMIT);
}
export function a(x: number): Promise<number> {
  return compute(scaled, x);
}
export function b(x: number): Promise<number> {
  return compute(summed, x);
}
`);

    expect(found.map((d) => [d.code, d.line])).toEqual([
      ["LUCENT3011", 12],
      ["LUCENT3011", 15],
    ]);
    expect(found[0]!.message).toBe(
      "`scaled` cannot run in a compute task: it reads module constant `TWICE`, which is not a literal: a reload of JavaScript assigns it again (declared at m.lucent.ts:3:7) (m.lucent.ts:6:14).",
    );
    expect(found[1]!.message).toMatch(/reads module constant `add`, which is not a literal/);
  });

  it("refuses async tasks, and tasks that start asynchronous work", () => {
    const found = refusals(`import { compute, delay } from "lucent:core";
async function slow(x: number): Promise<number> {
  return x;
}
function waits(x: number): number {
  void delay(x);
  return x;
}
export function first(x: number): Promise<number> {
  return compute(slow, x);
}
export function second(x: number): Promise<number> {
  return compute(waits, x);
}
`);

    expect(found.map((d) => d.code)).toEqual(["LUCENT3011", "LUCENT3011"]);
    expect(found[0]!.message).toMatch(/^`slow` cannot run in a compute task: it is async/);
    expect(found[1]!.message).toMatch(
      /^`waits` cannot run in a compute task: it calls `lucent:core\.delay`, which continues later/,
    );
  });

  it("refuses inputs and results that cannot cross, naming where", () => {
    const found = refusals(`import { compute } from "lucent:core";
type Job = { n: number; done: () => void };
function run(job: Job): number {
  return job.n;
}
function make(n: number): () => number {
  return () => n;
}
function wait(n: number): Promise<number> | number {
  return n;
}
export function a(job: Job): void {
  void compute(run, job);
}
export function b(): void {
  void compute(make, 1);
}
export function c(): void {
  void compute(wait, 2);
}
`);

    expect(found.map((d) => d.code)).toEqual(["LUCENT3012", "LUCENT3012", "LUCENT3012"]);
    expect(found[0]!.message).toBe(
      "the input of `run` cannot be copied to a compute task: `job.done` is a function.",
    );
    expect(found[1]!.message).toBe(
      "the result of `make` cannot come back from a compute task: it is a function.",
    );
    expect(found[2]!.message).toMatch(/^the result of `wait` cannot come back .*a promise/);
  });

  it("takes only functions declared at the top level, with one parameter", () => {
    const found = refusals(`import { compute } from "lucent:core";
function pair(a: number, b: number): number {
  return a + b;
}
function id<T>(x: T): T {
  return x;
}
export function a(x: number): Promise<number> {
  const local = (y: number) => y * 2;
  return compute(local, x);
}
export function b(x: number): Promise<number> {
  return compute((y: number) => y, x);
}
export function c(x: number): Promise<number> {
  return compute(pair as never, x);
}
export function d(x: number): Promise<number> {
  return compute(id, x);
}
`);

    expect(found.map((d) => d.code)).toEqual([
      "LUCENT1007",
      "LUCENT1007",
      "LUCENT1007",
      "LUCENT1007",
    ]);
    expect(found[0]!.message).toMatch(
      /compute runs a function declared at the top level of a module/,
    );
  });

  it("is not called from generic code, whose body is a C++ template", () => {
    const found = refusals(`import { compute } from "lucent:core";
function sum(xs: number[]): number {
  return xs.length;
}
async function via<T>(tag: T, xs: number[]): Promise<number> {
  return await compute(sum, xs);
}
export async function run(xs: number[]): Promise<number> {
  return await via("a", xs);
}
`);

    expect(found.map((d) => d.code)).toEqual(["LUCENT1007"]);
    expect(found[0]!.message).toMatch(/compute cannot be called from generic code yet/);
  });

  it("refuses inputs holding an abstract class, which cannot be copied as itself", () => {
    const found = refusals(`import { compute } from "lucent:core";
abstract class Shape {
  constructor(readonly size: number) {}
  abstract area(): number;
}
class Square extends Shape {
  area(): number {
    return this.size ** 2;
  }
}
function measure(shapes: Shape[]): number {
  return shapes.length;
}
export function run(): Promise<number> {
  return compute(measure, [new Square(2)]);
}
`);

    expect(found.map((d) => d.code)).toEqual(["LUCENT3012"]);
    expect(found[0]!.message).toMatch(/Shape is abstract/);
  });

  it("names each task entry apart, whatever the module and function names", () => {
    const { r, text } = build({
      a_b: "export function c(x: number): number {\n  return x;\n}\n",
      a: "export function b_c(x: number): number {\n  return x + 1;\n}\n",
      m: `import { compute } from "lucent:core";
import { c } from "./a_b.lucent.ts";
import { b_c } from "./a.lucent.ts";
export async function run(): Promise<number> {
  return (await compute(c, 1)) + (await compute(b_c, 2));
}
`,
    });
    const names = [...text("m_m.cpp").matchAll(/lucent::TaskEntry<[^>]*>, double> (\w+)\{/g)].map(
      (x) => x[1],
    );

    expect(r.diagnostics).toEqual([]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("runs a platform function's stub as it is on the host", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compute-host-"));
    const write = (name: string, source: string) => {
      const file = path.join(dir, name);

      fs.writeFileSync(file, source);
      return file;
    };
    const files = [
      write("p.lucent.ts", "export declare function heavy(x: number): number;\n"),
      write("p.ios.lucent.ts", "export function heavy(x: number): number {\n  return x;\n}\n"),
      write("p.android.lucent.ts", "export function heavy(x: number): number {\n  return x;\n}\n"),
      write(
        "m.lucent.ts",
        `import { compute } from "lucent:core";
import { heavy } from "./p.lucent.ts";
export function run(x: number): Promise<number> {
  return compute(heavy, x);
}
`,
      ),
    ];

    const r = compile(files, { platforms: ["host"] });

    expect(r.diagnostics).toEqual([]);
    expect(r.files.get("host/m_m.cpp")).toMatch(/return lucent_app::m_p::heavy\(std::move/);
  });

  it("takes its options as an object literal", () => {
    const found = refusals(`import { compute } from "lucent:core";
function double(x: number): number {
  return x * 2;
}
function start(x: number, options: { signal?: AbortSignal }): Promise<number> {
  return compute(double, x, options);
}
`);

    expect(found.map((d) => d.code)).toEqual(["LUCENT1007"]);
    expect(found[0]!.message).toMatch(/\{ signal \}/);
  });

  it.skipIf(!xcode)("refuses a task that uses a main-thread native object through a helper", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compute-ios-"));
    const shared = path.join(dir, "m.lucent.ts");
    const ios = path.join(dir, "m.ios.lucent.ts");
    const android = path.join(dir, "m.android.lucent.ts");

    fs.writeFileSync(shared, "export declare function run(): Promise<number>;\n");
    fs.writeFileSync(
      ios,
      `import { compute } from "lucent:core";
import { UIView } from "lucent:ios/UIKit";
function layout(n: number): number {
  new UIView().setNeedsLayout();
  return n;
}
export function run(): Promise<number> {
  return compute(layout, 1);
}
`,
    );
    fs.writeFileSync(android, "export async function run(): Promise<number> {\n  return 0;\n}\n");

    const r = compile([shared, ios, android], { platforms: ["ios"] });
    const d = r.diagnostics.find((x) => x.code === "LUCENT3011");

    expect(d!.message).toMatch(/`layout` cannot run in a compute task: it .*main thread/);
  });
});

describe("compute in lucent:core's JavaScript version", () => {
  type Compute = <T, R>(task: (input: T) => R, input: T) => Promise<R>;

  const { compute } = createRequire(import.meta.url)(coreJsPath()) as { compute: Compute };

  it("copies the input as the runtime does: own keys stay keys, aliases stay aliases", async () => {
    const shared = [1];
    const input = JSON.parse('{"__proto__": {"x": 1}}') as { a?: number[]; b?: number[] };

    input.a = shared;
    input.b = shared;

    const seen = await compute((copy) => {
      copy.a!.push(2);

      return [
        Object.keys(copy).join(","),
        Object.getPrototypeOf(copy) === Object.prototype,
        copy.b!.length,
      ];
    }, input);

    expect(seen).toEqual(["__proto__,a,b", true, 2]);
    expect(shared).toEqual([1]);
  });

  it("refuses to copy a function", async () => {
    await expect(compute((x) => x, { f: () => 1 })).rejects.toMatchObject({
      name: "DataCloneError",
    });
  });
});
