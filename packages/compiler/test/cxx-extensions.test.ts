/**
 * A native extension over a C++ header (decision 0125): its classes are
 * handle classes of `lucent:ext/<name>`, with their constructors' and
 * methods' overloads (one per default argument left out), its enums are
 * TypeScript enums, and what can't be bound is left out with its reason.
 * Read with the host's clang, as the C extensions' tests do.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import {
  bindExtensions,
  compile,
  extensionDts,
  type ExtensionBinding,
  type LucentPackage,
  resolveNative,
} from "../src/index.ts";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/tally");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

/** The fixture package, copied, its extension's declaration changed by `edit`. */
function tally(edit: (declaration: Record<string, any>) => void = () => {}): LucentPackage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cxx-ext-"));
  fs.cpSync(fixture, dir, { recursive: true });

  const file = path.join(dir, "lucent.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(json.extensions.tally);
  fs.writeFileSync(file, JSON.stringify(json));

  return { name: "lucent-tally", version: "1.0.0", dir, sources: path.join(dir, "src") };
}

const bind = (p: LucentPackage): ExtensionBinding =>
  bindExtensions(resolveNative([p]).extensions)[0]!;

// Read once: clang parses the standard library's headers each time.
let bound: ExtensionBinding | undefined;
const tallyBinding = () => (bound ??= bind(tally()));

describe.skipIf(!clang)("binding a C++ header", () => {
  it("binds its classes' constructors and methods, an overload per default argument", () => {
    const ext = tallyBinding();
    expect(ext.language).toBe("c++");

    const [counter] = ext.classes;
    expect(ext.classes.map((c) => [c.name, c.qualified, c.affinity])).toEqual([
      ["Counter", "tally::Counter", "any"],
    ]);
    expect(
      counter!.constructors.map((k) => k.params.map((p) => `${p.name}: ${p.value.kind}`)),
    ).toEqual([[], ["start: number"], ["name: string"], ["name: string", "step: number"]]);
    expect(counter!.methods.map((m) => `${m.static ? "static " : ""}${m.name}`)).toEqual([
      "add",
      "total",
      "name",
      "rename",
      "history",
      "tags",
      "tag",
      "note",
      "setNote",
      "setRounding",
      "rounding",
      "merge",
      "split",
      "fail",
      "static live",
      "each",
      "countTags",
      "onAdd",
    ]);
    const method = (name: string) => counter!.methods.find((m) => m.name === name)!.overloads[0]!;
    expect(method("total").result).toEqual({ kind: "bigint", c: "long long" });
    expect(method("history").result).toEqual({
      kind: "array",
      of: { kind: "number", c: "double" },
      c: "double",
    });
    expect(method("note").result).toEqual({
      kind: "optional",
      of: { kind: "string", of: "string" },
      c: "std::string",
    });
    expect(method("setRounding").params).toEqual([
      { name: "rounding", value: { kind: "enum", name: "Rounding", cxx: "tally::Rounding" } },
    ]);
    expect(method("merge").params[0]!.value).toEqual({
      kind: "object",
      class: "Counter",
      cxx: "tally::Counter",
      by: "constRef",
    });
    expect(method("split").result).toMatchObject({ kind: "object", by: "value" });
    // A std::function: a callback, with what it takes and gives.
    expect(method("countTags").params[0]!.value).toEqual({
      kind: "callback",
      params: [
        { kind: "string", of: "string" },
        { kind: "bigint", c: "long long" },
      ],
      result: { kind: "boolean" },
    });
    expect(method("onAdd").params[0]!.value).toEqual({
      kind: "callback",
      params: [
        { kind: "string", of: "string_view" },
        { kind: "number", c: "double" },
      ],
    });

    expect(ext.enums).toEqual([
      {
        name: "Rounding",
        qualified: "tally::Rounding",
        values: [
          { name: "Down", value: 0 },
          { name: "Nearest", value: 2 },
          { name: "Up", value: 3 },
        ],
      },
    ]);
    // Its C function, as a C header's.
    expect(ext.functions.map((f) => f.name)).toEqual(["tally_version"]);
  });

  it("leaves out what it can't bind, saying why", () => {
    expect(tallyBinding().skipped).toEqual([
      "Counter.self: tally::Counter *: who owns the object is unknown; a result by value is a new handle",
      "Counter.scale(number): overloads TypeScript can't tell apart, so neither is bound",
      "Counter.visit(callback): overloads whose callbacks C++ can't tell apart, so neither is bound",
    ]);
  });

  it("fails for a class the declaration names that the header doesn't bind", () => {
    expect(() => bind(tally((d) => (d.classes = { Tally: { affinity: "main" } })))).toThrow(
      "lucent-tally/lucent.json: extensions.tally.classes.Tally: tally.hpp has no class Tally Lucent binds",
    );
  });

  it("reads a C++ header as C++ alone, failing with clang's errors", () => {
    const p = tally();
    fs.writeFileSync(path.join(p.dir, "native/tally.hpp"), "class Broken { int x }\n");
    expect(() => bind(p)).toThrow(
      /lucent-tally\/lucent\.json: extensions\.tally\.header: tally\.hpp does not compile as C\+\+: .*expected ';'/,
    );
  });
});

describe.skipIf(!clang)("a C++ extension's declarations", () => {
  it("declare each class with its overloads, and each enum", () => {
    const dts = extensionDts(tallyBinding());

    expect(dts).toContain("export declare class Counter {");
    expect(dts).toContain(
      "  constructor();\n  constructor(start: number);\n  constructor(name: string);\n  constructor(name: string, step: number);",
    );
    expect(dts).toContain("  add(by: number): number;");
    expect(dts).toContain("  total(): bigint;");
    expect(dts).toContain("  history(): number[];");
    expect(dts).toContain("  tag(tags: string[]): void;");
    expect(dts).toContain("  note(): string | undefined;");
    expect(dts).toContain("  setNote(note: string | undefined): void;");
    expect(dts).toContain("  setRounding(rounding: Rounding): void;");
    expect(dts).toContain("  merge(other: Counter): void;");
    expect(dts).toContain("  split(): Counter;");
    expect(dts).toContain("  static live(): number;");
    expect(dts).toContain("  each(visit: (arg0: number) => void): void;");
    expect(dts).toContain("  countTags(keep: (arg0: string, arg1: bigint) => boolean): number;");
    expect(dts).toContain("  onAdd(listen: (arg0: string, arg1: number) => void): void;");
    expect(dts).toContain(
      "export declare enum Rounding {\n  Down = 0,\n  Nearest = 2,\n  Up = 3,\n}",
    );
    expect(dts).toContain("export declare function tally_version(): number;");
    expect(dts).toContain("//   Counter.self: tally::Counter *");
  });

  it("type-check on their own, without skipLibCheck", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cxx-dts-"));
    const file = path.join(dir, "tally.d.ts");
    fs.writeFileSync(file, extensionDts(tallyBinding()));

    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts", "lib.esnext.disposable.d.ts"],
      types: [],
    });

    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    ).toEqual([]);
  });
});

describe.skipIf(!clang)("compiling code that uses a C++ extension", () => {
  const cppOf = (r: ReturnType<typeof compile>) =>
    [...r.files]
      .filter(([f]) => f.endsWith(".cpp"))
      .map(([, text]) => text)
      .join("\n");
  const source = (text: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cxx-src-"));
    const file = path.join(dir, "use.lucent.ts");
    fs.writeFileSync(file, text);
    return file;
  };

  it("calls the classes' members inside cxxCall, the objects deleted by their handles", () => {
    const r = compile([path.join(fixture, "src/count.lucent.ts")], {
      extensions: [tallyBinding()],
    });
    expect(r.diagnostics).toEqual([]);

    const cpp = cppOf(r);
    expect(cpp).toContain('#include "tally.hpp"');
    // `new Counter(name, 2)`: the two-argument overload, its arguments converted first.
    expect(cpp).toMatch(
      /lucent::ext::cxxCall\("new Counter", \[&\]\(\) \{\n(?:#line.*\n)?\s*return new ::tally::Counter\(x_\d+_, x_\d+_\);/,
    );
    expect(cpp).toContain("lucent::ext::cxxString(");
    expect(cpp).toContain("&lucent::ext::deleteObject<::tally::Counter>");
    expect(cpp).toMatch(
      /lucent::ext::cxxCall\("Counter\.add", \[&\]\(\) \{\n(?:#line.*\n)?\s*return x_\d+_\.get\(\)->add\(x_\d+_\);/,
    );
    // An enum is its value, cast to C++'s type.
    expect(cpp).toContain("static_cast<::tally::Rounding>(lucent::ext::integer<long long>(");
    // A C function of the C++ header, as a C header's.
    expect(cpp).toContain("::tally_version()");
  });

  it("calls a static member function, and picks an overload by its arguments' types", () => {
    const r = compile(
      [
        source(`import { Counter } from "lucent:ext/tally";

export function made(): string {
  const a = new Counter(5);
  const b = new Counter("b");
  const out = \`\${Counter.live()} \${a.total()} \${b.name()}\`;
  a.close();
  b.close();
  return out;
}
`),
      ],
      { extensions: [tallyBinding()] },
    );
    expect(r.diagnostics).toEqual([]);

    const cpp = cppOf(r);
    expect(cpp).toContain("return ::tally::Counter::live();");
    expect(cpp).toMatch(/new ::tally::Counter\(x_\d+_\)/);
    expect(cpp).toContain("lucent::ext::integer<int>(");
    expect(cpp).toContain("lucent::ext::fromCxx(");
  });

  it("gives C++ a std::function of the callback, which it may keep, and ends the call's hold", () => {
    const r = compile(
      [
        source(`import { Counter } from "lucent:ext/tally";

export function heard(): string {
  const c = new Counter("c");
  const out: string[] = [];
  c.onAdd((name, total) => out.push(\`\${name}=\${total}\`));
  c.add(1);
  c.close();
  return out.join(" ");
}
`),
      ],
      { extensions: [tallyBinding()] },
    );
    expect(r.diagnostics).toEqual([]);

    const cpp = cppOf(r);
    expect(cpp).toMatch(
      /auto x_\d+_ = lucent::ext::Callback<lucent::Fn<void\(lucent::String, double\)>>\("Counter\.onAdd's listen", lucent::ext::Lives::Copies, x_\d+_\);/,
    );
    expect(cpp).toMatch(/->onAdd\(x_\d+_\.function\(\)\)/);
    expect(cpp).toMatch(/x_\d+_\.done\(\);/);
  });

  it("requires a main-thread class to be used in main()", () => {
    const main = bind(tally((d) => (d.classes = { Counter: { affinity: "main" } })));
    const r = compile(
      [
        source(`import { Counter } from "lucent:ext/tally";

export function count(): number {
  const c = new Counter();
  return c.add(1);
}
`),
      ],
      { extensions: [main] },
    );
    expect(r.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
      "LUCENT3006",
      "Counter can only be used on the main thread: call it inside main(() => …) from lucent:thread",
    ]);
  });
});
