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
