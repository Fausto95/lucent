/**
 * A differential fuzzer: random programs in Lucent's subset, compiled and
 * run natively and as JavaScript through the e2e runner (run.ts), whose
 * outputs must match line for line.
 *
 *   node packages/compiler/test/e2e/fuzz.ts [--seed N] [--count N] [--functions N] [--keep DIR]
 *
 * Each program is a module of exported functions over numbers, strings,
 * booleans, bigints, optionals and arrays: loops whose closures capture
 * their `let` counters, `??` and `??=` (also on type parameters), compound
 * assignments, reduce, try/catch around throwing bigint division. A program
 * the compiler refuses with a LUCENT diagnostic is skipped (the subset is
 * smaller than what the generator writes); a TypeScript error (the
 * generator's bug) or an internal compiler error fails, as does any
 * difference in output. Programs are written to --keep (default: a
 * temporary directory), each with its seed, to rerun with run.ts.
 *
 * Env: as run.ts (HERMES_DIR, LUCENT_E2E_JOBS, CXX).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../src/index.ts";

/** A small, seeded PRNG (mulberry32): one seed, one program, on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ty = "number" | "string" | "boolean" | "bigint" | "opt" | "array";

const TS_TYPE: Record<Ty, string> = {
  number: "number",
  string: "string",
  boolean: "boolean",
  bigint: "bigint",
  opt: "number | undefined",
  array: "number[]",
};

interface Var {
  name: string;
  ty: Ty;
  /** Whether it may be assigned (a `let` the generator did not make a loop counter). */
  mutable: boolean;
}

const WORDS = ['"a"', '"bc"', '"xyz"', '""', '"Q"'];

/** The module-level helpers every program may call. */
const PRELUDE = `// Literals go through these, so TypeScript types them as their wide types: \`3 ?? x\`
// and \`"a" === "b"\` are errors of its own.
function num(x: number): number {
  return x;
}

function str(x: string): string {
  return x;
}

function bool(x: boolean): boolean {
  return x;
}

function big(x: bigint): bigint {
  return x;
}

function opt(x: number | undefined): number | undefined {
  return x;
}

function nums(...xs: number[]): number[] {
  return xs;
}

function pick<T>(x: T, d: T): T {
  return x ?? d;
}

function fill<T>(x: T, d: T): T {
  let v = x;
  v ??= d;
  return v;
}

function first<T>(xs: T[], d: T): T {
  return xs[0] ?? d;
}

function div(a: bigint, b: bigint): string {
  try {
    return String(a / b);
  } catch (e) {
    return (e as Error).name;
  }
}
`;

class Generator {
  private readonly r: () => number;
  private scopes: Var[][] = [];
  private names = 0;
  private lines: string[] = [];
  private indent = 1;
  /** How deep the statements being written are nested. */
  private nesting = 0;

  constructor(seed: number) {
    this.r = rng(seed);
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.r() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.r() < p;
  }

  pickOf<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.r() * xs.length)]!;
  }

  fresh(prefix: string): string {
    return `${prefix}${this.names++}`;
  }

  vars(ty: Ty, mutable = false): Var[] {
    return this.scopes.flat().filter((v) => v.ty === ty && (!mutable || v.mutable));
  }

  emit(line: string): void {
    this.lines.push(`${"  ".repeat(this.indent)}${line}`);
  }

  block(head: string, body: () => void, tail = "}"): void {
    this.emit(`${head} {`);
    this.indent++;
    this.nesting++;
    this.scopes.push([]);
    body();
    this.scopes.pop();
    this.nesting--;
    this.indent--;
    this.emit(tail);
  }

  declare(v: Var): void {
    this.scopes[this.scopes.length - 1]!.push(v);
  }

  /** An expression of type `ty`, at most `depth` operators deep. */
  expr(ty: Ty, depth: number): string {
    const leaf = depth <= 0 || this.chance(0.3);
    const vs = this.vars(ty);

    if (leaf || this.chance(0.15)) {
      if (vs.length && this.chance(0.7)) return this.pickOf(vs).name;

      return this.literal(ty);
    }

    const d = depth - 1;
    const forms = FORMS[ty];

    return this.pickOf(forms)(this, d);
  }

  literal(ty: Ty): string {
    switch (ty) {
      case "number":
        return `num(${this.int(-4, 12)})`;
      case "string":
        return `str(${this.pickOf(WORDS)})`;
      case "boolean":
        return `bool(${this.chance(0.5)})`;
      case "bigint":
        return `big(${this.int(-3, 9)}n)`;
      case "opt":
        return `opt(${this.chance(0.4) ? "undefined" : this.int(0, 9)})`;
      case "array":
        return `nums(${Array.from({ length: this.int(0, 3) }, () => this.int(-2, 9)).join(", ")})`;
    }
  }

  /** A statement in a function body, which pushes what it observes to `out`. */
  statement(depth: number): void {
    const kinds: (() => void)[] = [
      () => this.declaration(),
      () => this.declaration(),
      () => this.assignment(),
      () => this.assignment(),
      () => this.observe(),
    ];

    if (depth > 0 && this.nesting < 3) {
      kinds.push(
        () => this.ifStatement(depth),
        () => this.forLoop(depth),
        () => this.whileLoop(depth),
      );
    }

    this.pickOf(kinds)();
  }

  declaration(): void {
    const ty = this.pickOf<Ty>(["number", "number", "string", "boolean", "bigint", "opt", "array"]);
    const name = this.fresh("v");
    const init = ty === "opt" ? this.optInit() : this.expr(ty, 2);

    this.emit(`let ${name}: ${TS_TYPE[ty]} = ${init};`);
    this.declare({ name, ty, mutable: true });
  }

  optInit(): string {
    return this.chance(0.5) ? this.expr("opt", 2) : `${this.expr("number", 1)}`;
  }

  assignment(): void {
    const ty = this.pickOf<Ty>(["number", "number", "string", "bigint", "opt", "array", "boolean"]);
    const targets = this.vars(ty, true);

    if (!targets.length) return this.declaration();

    const t = this.pickOf(targets).name;

    switch (ty) {
      case "number":
        return this.emit(
          `${t} ${this.pickOf(["=", "+=", "-=", "*=", "||="])} ${this.expr("number", 2)};`,
        );
      case "string":
        return this.emit(`${t} ${this.pickOf(["=", "+="])} ${this.expr("string", 2)};`);
      case "bigint":
        return this.emit(`${t} ${this.pickOf(["=", "+=", "-="])} ${this.expr("bigint", 1)};`);
      case "opt":
        return this.emit(
          this.chance(0.5)
            ? `${t} ??= ${this.expr("number", 2)};`
            : `${t} = ${this.expr("opt", 2)};`,
        );
      case "array":
        return this.emit(
          this.chance(0.7)
            ? `${t}.push(${this.expr("number", 2)});`
            : `${t} = ${this.expr("array", 1)};`,
        );
      case "boolean":
        return this.emit(`${t} ${this.pickOf(["=", "&&=", "||="])} ${this.expr("boolean", 2)};`);
      default:
        return undefined;
    }
  }

  /** `out.push(…)` of some value, spelled the same in both runs. */
  observe(): void {
    const ty = this.pickOf<Ty>(["number", "string", "boolean", "bigint", "opt", "array"]);
    const e = this.expr(ty, 3);

    switch (ty) {
      case "opt":
        return this.emit(`out.push(${show(e)});`);
      case "array":
        return this.emit(`out.push(${e}.join(","));`);
      default:
        return this.emit(`out.push(String(${e}));`);
    }
  }

  ifStatement(depth: number): void {
    this.block(`if (${this.expr("boolean", 2)})`, () => this.statements(depth - 1, 1, 3));

    if (this.chance(0.4)) {
      this.lines[this.lines.length - 1] += " else {";
      this.indent++;
      this.nesting++;
      this.scopes.push([]);
      this.statements(depth - 1, 1, 2);
      this.scopes.pop();
      this.nesting--;
      this.indent--;
      this.emit("}");
    }
  }

  /** A `for (let …)` whose closures capture its counter, which the body may step too. */
  forLoop(depth: number): void {
    const i = this.fresh("i");
    const bound = this.int(1, 6);
    const step = this.pickOf(["i++", "i += 2", "++i"]).replace("i", i);

    this.block(`for (let ${i} = ${this.int(-1, 1)}; ${i} < ${bound}; ${step})`, () => {
      this.declare({ name: i, ty: "number", mutable: false });

      const captured = this.vars("number").filter((v) => v.name !== i);
      const other = captured.length && this.chance(0.5) ? ` + ${this.pickOf(captured).name}` : "";

      if (this.chance(0.8)) this.emit(`fns.push(() => ${i} * 3${other});`);

      // A closure that writes what it captures.
      const writable = this.vars("number", true);

      if (writable.length && this.chance(0.3)) {
        const w = this.pickOf(writable).name;

        this.emit(`fns.push(() => (${w} += ${i}));`);
      }

      this.statements(depth - 1, 0, 3);

      if (this.chance(0.3)) this.emit(`if (${i} % 2 === 0) ${i}++;`);

      if (this.chance(0.2)) this.emit(`if (${i} === ${this.int(0, 3)}) continue;`);
    });
  }

  whileLoop(depth: number): void {
    const w = this.fresh("w");

    this.emit(`let ${w} = 0;`);
    this.block(`while (${w} < ${this.int(1, 4)})`, () => {
      this.declare({ name: w, ty: "number", mutable: false });
      this.emit(`${w}++;`);
      this.statements(depth - 1, 1, 3);

      if (this.chance(0.2)) this.emit(`if (${this.expr("boolean", 1)}) break;`);
    });
  }

  statements(depth: number, min: number, max: number): void {
    const n = this.int(min, max);

    for (let k = 0; k < n; k++) this.statement(depth);
  }

  /** An exported function `name(p: number, s: string): string`. */
  fn(name: string): string {
    this.lines = [];
    this.indent = 1;
    this.scopes = [
      [
        { name: "p", ty: "number", mutable: false },
        { name: "s", ty: "string", mutable: false },
        { name: "q", ty: "opt", mutable: false },
      ],
    ];
    this.emit("const out: string[] = [];");
    this.emit("const fns: (() => number)[] = [];");
    this.statements(3, 3, 7);
    this.emit('out.push(fns.map((f) => f()).join(","));');
    this.emit('return out.join(" | ");');

    return `export function ${name}(p: number, s: string, q: number | undefined): string {\n${this.lines.join("\n")}\n}\n`;
  }
}

/** How an optional prints the same in both runs. */
function show(e: string): string {
  return `((t: number | undefined) => (t === undefined ? "u" : String(t)))(${e})`;
}

type Form = (g: Generator, depth: number) => string;

const FORMS: Record<Ty, Form[]> = {
  number: [
    (g, d) => `(${g.expr("number", d)} ${g.pickOf(["+", "-", "*"])} ${g.expr("number", d)})`,
    (g, d) => `(${g.expr("number", d)} % ${g.int(1, 7)})`,
    (g, d) => `Math.floor(${g.expr("number", d)} / ${g.int(1, 5)})`,
    (g, d) => `(${g.expr("boolean", d)} ? ${g.expr("number", d)} : ${g.expr("number", d)})`,
    (g, d) => `${g.expr("string", d)}.length`,
    (g, d) => `${g.expr("array", d)}.length`,
    (g, d) => `(${g.expr("opt", d)} ?? ${g.expr("number", d)})`,
    (g, d) => `(${g.expr("number", d)} || ${g.expr("number", d)})`,
    (g, d) => `(${g.expr("number", d)} && ${g.expr("number", d)})`,
    (g, d) => `${g.expr("array", d)}.reduce((a, c) => a + c, ${g.expr("number", d)})`,
    (g, d) => `(pick<number | undefined>(${g.expr("opt", d)}, ${g.expr("opt", d)}) ?? -1)`,
    (g, d) => `(fill<number | undefined>(${g.expr("opt", d)}, ${g.expr("number", d)}) ?? -2)`,
    (g, d) => `pick<number>(${g.expr("number", d)}, ${g.expr("number", d)})`,
    (g, d) => `first<number>(${g.expr("array", d)}, ${g.expr("number", d)})`,
    (g, d) => `Number(${g.expr("bigint", d)})`,
    (g, d) => `(${g.expr("number", d)} ${g.pickOf(["|", "&", "^", "<<", ">>"])} ${g.int(0, 5)})`,
  ],
  string: [
    (g, d) => `(${g.expr("string", d)} + ${g.expr("string", d)})`,
    (g, d) => `\`\${${g.expr("number", d)}}:\${${g.expr("string", d)}}\``,
    (g, d) => `String(${g.expr("number", d)})`,
    (g, d) => `(${g.expr("boolean", d)} ? ${g.expr("string", d)} : ${g.expr("string", d)})`,
    (g, d) => `${g.expr("string", d)}.toUpperCase()`,
    (g, d) => `${g.expr("string", d)}.slice(${g.int(-2, 2)})`,
    (g, d) => `${g.expr("array", d)}.join("-")`,
    (g, d) => `div(${g.expr("bigint", d)}, ${g.expr("bigint", d)})`,
    (g, d) => `pick<string>(${g.expr("string", d)}, ${g.expr("string", d)})`,
  ],
  boolean: [
    (g, d) =>
      `(${g.expr("number", d)} ${g.pickOf(["<", "<=", "===", "!==", ">"])} ${g.expr("number", d)})`,
    (g, d) => `(${g.expr("string", d)} === ${g.expr("string", d)})`,
    (g, d) => `!${g.expr("boolean", d)}`,
    (g, d) => `(${g.expr("boolean", d)} ${g.pickOf(["&&", "||"])} ${g.expr("boolean", d)})`,
    (g, d) => `(${g.expr("opt", d)} === undefined)`,
    (g, d) => `(${g.expr("bigint", d)} < ${g.expr("bigint", d)})`,
    (g, d) => `${g.expr("array", d)}.includes(${g.expr("number", d)})`,
  ],
  bigint: [
    (g, d) => `(${g.expr("bigint", d)} ${g.pickOf(["+", "-", "*"])} ${g.expr("bigint", d)})`,
    (g) => `BigInt(${g.int(-5, 20)})`,
    (g, d) => `(${g.expr("boolean", d)} ? ${g.expr("bigint", d)} : ${g.expr("bigint", d)})`,
  ],
  opt: [
    (g, d) => `(${g.expr("boolean", d)} ? undefined : ${g.expr("number", d)})`,
    (g, d) => `${g.expr("array", d)}[${g.int(0, 3)}]`,
    (g, d) => `${g.expr("array", d)}.find((x) => x > ${g.expr("number", d)})`,
    (g, d) => `pick<number | undefined>(${g.expr("opt", d)}, ${g.expr("opt", d)})`,
  ],
  array: [
    (g, d) => `${g.expr("array", d)}.map((x) => x ${g.pickOf(["+", "*", "-"])} ${g.int(1, 4)})`,
    (g, d) => `${g.expr("array", d)}.filter((x) => x % ${g.int(2, 3)} === 0)`,
    (g, d) => `[...${g.expr("array", d)}, ${g.expr("number", d)}]`,
    (g, d) => `${g.expr("array", d)}.slice(${g.int(0, 2)})`,
  ],
};

/** Program `seed`: its module's source and the test script that calls it. */
export function generate(seed: number, functions = 6): { source: string; test: string } {
  const g = new Generator(seed);
  const names = Array.from({ length: functions }, (_, k) => `f${k}`);
  const source = `// Generated by fuzz.ts, seed ${seed}.\n${PRELUDE}\n${names.map((n) => g.fn(n)).join("\n")}`;
  const args = ["3, 'ab', 2", "-2, '', undefined", "0, 'xyz', 0"];
  const test = names.flatMap((n) => args.map((a) => `print(mod.${n}(${a}));`)).join("\n") + "\n";

  return { source, test };
}

/** What compiling program `source` gives: compiled, refused (an ordinary diagnostic) or failed. */
export function triage(file: string): { kind: "ok" | "refused" | "failed"; detail: string } {
  let r: ReturnType<typeof compile>;

  try {
    r = compile([file]);
  } catch (e) {
    return { kind: "failed", detail: `the compiler threw: ${(e as Error).stack}` };
  }

  if (r.ok) return { kind: "ok", detail: "" };

  const detail = r.diagnostics
    .map((d) => `${d.code} ${d.line}:${d.column} ${d.message}`)
    .join("\n");
  const failed = r.diagnostics.some((d) => d.code === "LUCENT9001" || d.code === "LUCENT9002");

  return { kind: failed ? "failed" : "refused", detail };
}

function main(): void {
  const args = process.argv.slice(2);
  const opt = (name: string, d: number) => {
    const i = args.indexOf(`--${name}`);

    return i >= 0 ? Number(args[i + 1]) : d;
  };
  const keepAt = args.indexOf("--keep");
  const seed = opt("seed", Date.now() % 100000);
  const count = opt("count", 4);
  const functions = opt("functions", 6);
  const dir =
    keepAt >= 0
      ? path.resolve(args[keepAt + 1]!)
      : fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fuzz-"));

  fs.mkdirSync(dir, { recursive: true });

  let failed = 0;
  const run: string[] = [];

  for (let k = 0; k < count; k++) {
    const s = seed + k;
    const name = `fuzz-${s}`;
    const { source, test } = generate(s, functions);
    const file = path.join(dir, `${name}.lucent.ts`);

    fs.writeFileSync(file, source);
    fs.writeFileSync(path.join(dir, `${name}.test.js`), test);

    const t = triage(file);

    if (t.kind === "failed") {
      failed++;
      console.log(`✗ ${name}: ${t.detail}`);
    } else if (t.kind === "refused") {
      console.log(`- ${name}: refused (skipped)\n  ${t.detail.split("\n").join("\n  ")}`);
      fs.rmSync(path.join(dir, `${name}.test.js`));
    } else run.push(name);
  }

  if (run.length) {
    const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.ts");
    const r = spawnSync(process.execPath, [runner, ...run], {
      stdio: "inherit",
      env: { ...process.env, LUCENT_E2E_CASES: dir },
    });

    if (r.status !== 0) failed++;
  }

  console.log(
    `${count} program(s) from seed ${seed}: ${run.length} run, ${count - run.length} not; in ${dir}`,
  );

  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
