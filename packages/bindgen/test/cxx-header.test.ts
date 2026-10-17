/**
 * A C++ header as clang reads it (decision 0125): its classes and enums,
 * each class's public constructors and members with their types as they
 * cross into Lucent, its C functions, and what can't be bound, with why.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { type Node, readDump } from "../src/c-header.ts";
import {
  type CxxClass,
  type CxxHeader,
  extractCxxHeader,
  type CxxNode,
  formatCxxType,
  parseSpelling,
  readCxxAst,
} from "../src/cxx-header.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/cxx");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

describe("C++ spellings", () => {
  it("reads names, template arguments, const and what wraps them", () => {
    expect(parseSpelling("const std::vector<std::basic_string<char>> &")).toEqual({
      name: "std::vector",
      args: [
        {
          name: "std::basic_string",
          args: [{ name: "char", args: [], const: false, wraps: [] }],
          const: false,
          wraps: [],
        },
      ],
      const: true,
      wraps: ["&"],
    });
    expect(parseSpelling("unsigned long long")).toMatchObject({ name: "unsigned long long" });
    expect(parseSpelling("acme::Counter *const")).toMatchObject({
      name: "acme::Counter",
      wraps: ["*"],
    });
    expect(parseSpelling("Counter &&")).toMatchObject({ wraps: ["&&"] });
  });

  it("reads a function type as a template argument, and a pointer to one", () => {
    const none = { args: [], const: false, wraps: [] };
    expect(parseSpelling("std::function<int (double, const char *)>")).toEqual({
      name: "std::function",
      args: [
        {
          name: "int",
          ...none,
          params: [
            { name: "double", ...none },
            { name: "char", args: [], const: true, wraps: ["*"] },
          ],
        },
      ],
      const: false,
      wraps: [],
    });
    expect(parseSpelling("std::function<void ()>").args[0]).toMatchObject({ params: [] });
    expect(parseSpelling("void (*)(int, void *)")).toMatchObject({
      name: "void",
      pointer: true,
      params: [{ name: "int" }, { name: "void", wraps: ["*"] }],
    });
  });
});

describe.skipIf(!clang)("a C++ header", () => {
  // Read once: clang parses the standard library's headers each time.
  let read: CxxHeader | undefined;
  const header = (): CxxHeader => (read ??= extractCxxHeader(path.join(fixtures, "counter.hpp")));
  const counter = (): CxxClass => header().classes.find((c) => c.name === "Counter")!;
  const types = (c: CxxClass, name: string) => {
    const m = c.methods.find((x) => x.name === name)!;
    return [...m.params.map((p) => formatCxxType(p.type)), "->", formatCxxType(m.result)];
  };

  it("has its classes and enums, by their qualified names", () => {
    const h = header();
    expect(h.classes.map((c) => [c.qualified, c.refused])).toEqual([
      ["acme::Counter", undefined],
      ["acme::Point", undefined],
      ["acme::Derived", "it has a base class"],
      ["acme::Shape", "it is abstract"],
    ]);
    expect(h.enums).toEqual([
      {
        name: "Mode",
        qualified: "acme::Mode",
        scoped: true,
        values: [
          { name: "Fast", value: 0 },
          { name: "Exact", value: 4 },
          { name: "Gentle", value: 5 },
        ],
      },
      {
        name: "Level",
        qualified: "acme::Level",
        scoped: false,
        values: [
          { name: "Low", value: -1 },
          { name: "High", value: 1 },
        ],
      },
    ]);
    expect(h.skipped).toEqual([
      "Box: a class template, which Lucent doesn't bind",
      "greet: a C++ function; Lucent binds classes and C functions",
    ]);
    expect(h.functions.map((f) => f.name)).toEqual(["acme_version"]);
  });

  it("has a class's public constructors, but its copies and moves", () => {
    expect(
      counter().constructors.map((c) =>
        c.params.map((p) => `${formatCxxType(p.type)}${p.defaulted ? " = …" : ""}`),
      ),
    ).toEqual([[], ["int"], ["std::string", "double = …"]]);
    // A struct's members are public by default.
    const point = header().classes.find((c) => c.name === "Point")!;
    expect(point.methods.map((m) => m.name)).toEqual(["x"]);
  });

  it("reads each member's types as they cross", () => {
    const c = counter();
    expect(c.methods.map((m) => m.name)).toEqual([
      "bump",
      "value",
      "name",
      "rename",
      "label",
      "history",
      "tags",
      "note",
      "setMode",
      "mode",
      "level",
      "merge",
      "split",
      "shared",
      "count",
      "raw",
      "each",
      "countIf",
      "onTick",
      "legacy",
      "countUntil",
    ]);
    expect(types(c, "bump")).toEqual(["int", "->", "long long"]);
    expect(types(c, "value")).toEqual(["->", "double"]);
    expect(types(c, "rename")).toEqual(["std::string_view", "->", "void"]);
    expect(types(c, "label")).toEqual(["const char *", "->", "void"]);
    expect(types(c, "history")).toEqual(["->", "std::vector<double>"]);
    expect(types(c, "tags")).toEqual(["->", "std::vector<std::string>"]);
    expect(types(c, "note")).toEqual(["->", "std::optional<std::string>"]);
    expect(types(c, "setMode")).toEqual(["acme::Mode", "->", "void"]);
    expect(types(c, "level")).toEqual(["->", "acme::Level"]);
    expect(types(c, "merge")).toEqual(["const acme::Counter &", "->", "void"]);
    expect(types(c, "split")).toEqual(["->", "acme::Counter"]);
    expect(types(c, "shared")).toEqual(["->", "acme::Counter *"]);
    expect(types(c, "raw")).toEqual(["->", "void *"]);
    expect(types(c, "each")).toEqual(["std::function<void (double, std::string)>", "->", "void"]);
    expect(types(c, "countIf")).toEqual(["std::function<bool (long long)>", "->", "int"]);
    expect(types(c, "onTick")).toEqual(["std::function<void ()>", "->", "void"]);
    // A C function pointer is no std::function: C++ callbacks are those.
    expect(types(c, "legacy")).toEqual(["void (*)(int, void *)", "void *", "->", "void"]);
    // A call's AbortSignal, as C++ reads it (decision 0129).
    expect(types(c, "countUntil")).toEqual(["int", "const std::atomic<bool> &", "->", "int"]);
    expect(c.methods.find((m) => m.name === "value")!.const).toBe(true);
    expect(c.methods.find((m) => m.name === "count")!.static).toBe(true);
    expect(c.skipped).toEqual(["as: a member template"]);
  });
});

describe.skipIf(!clang)("clang's dump of a C++ header", () => {
  it("is read one declaration at a time, other files' namespaces kept as where they end", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-dump-"));
    const write = (name: string, text: string) => {
      fs.writeFileSync(path.join(dir, name), text);
      return path.join(dir, name);
    };

    write("deep.h", "struct Deep { int d; };\n");
    // A namespace that ends in another file than it begins in.
    write("other.h", 'namespace other {\n#include "deep.h"\nstruct Other { int o; };\n}\n');
    const header = write(
      "mine.hpp",
      '#include "other.h"\nnamespace mine { class A { public: int a(); }; }\n' +
        // The same file as the namespace before: clang doesn't print it again.
        "namespace mine2 { class B { public: int b(); }; }\n" +
        "namespace other { class C { public: int c(); }; }\n",
    );

    const dump = path.join(dir, "ast.json");
    const out = fs.openSync(dump, "w");
    spawnSync(
      process.env.LUCENT_CLANG ?? "clang",
      ["-x", "c++", "-std=c++20", "-fsyntax-only", "-Xclang", "-ast-dump=json", header],
      { stdio: ["ignore", out, "inherit"] },
    );
    fs.closeSync(out);

    const unit = readDump(dump, fs.realpathSync(header));
    const namespaces = (unit.inner ?? []).filter((n) => n.kind === "NamespaceDecl");
    expect(namespaces.map((n) => [n.name, !!n.inner, path.basename(n.loc?.file ?? "")])).toEqual([
      ["other", false, "other.h"],
      ["mine", true, "mine.hpp"],
      ["mine2", true, ""],
      ["other", true, ""],
    ]);

    // What a reader makes of it is what it makes of the whole dump.
    const whole = JSON.parse(fs.readFileSync(dump, "utf8")) as Node;
    expect(readCxxAst(unit as CxxNode, header)).toEqual(readCxxAst(whole as CxxNode, header));
    expect(readCxxAst(unit as CxxNode, header).classes.map((c) => c.qualified)).toEqual([
      "mine::A",
      "mine2::B",
      "other::C",
    ]);
  });
});
