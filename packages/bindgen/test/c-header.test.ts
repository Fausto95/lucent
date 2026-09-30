import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { cLinkage, type CType, extractCHeader, formatCType, parseCType } from "../src/c-header.ts";
import { uint64Name } from "./c-types.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/c");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

const int = (name: string, signed: boolean, bits: 8 | 16 | 32 | 64): CType => ({
  k: "int",
  name,
  signed,
  bits,
});
const ptr = (to: CType, isConst = false): CType => ({ k: "pointer", to, const: isConst });
const record = (name: string): CType => ({ k: "record", name });

describe("C type spellings", () => {
  it("reads qualifiers, pointers and integer names clang prints", () => {
    expect(parseCType("const unsigned char *")).toEqual(ptr(int("unsigned char", false, 8), true));
    expect(parseCType("unsigned long int")).toEqual(int("unsigned long", false, 64));
    expect(parseCType("struct Gauge *_Nonnull")).toEqual(ptr(record("Gauge")));
    expect(parseCType("char **")).toEqual(ptr(ptr(int("char", true, 8))));
    expect(parseCType("void (*)(int, void *)")).toEqual({ k: "function" });
    expect(parseCType("_Bool")).toEqual({ k: "bool" });
  });

  it("follows typedef names through the resolver it is given", () => {
    const typedef = (name: string) =>
      name === "size_t" ? int("unsigned long", false, 64) : undefined;

    expect(parseCType("const size_t *", typedef)).toEqual(
      ptr(int("unsigned long", false, 64), true),
    );
    expect(parseCType("mystery_t", typedef)).toEqual({ k: "unknown", spelling: "mystery_t" });
  });

  it("spells a type as C does, for messages", () => {
    expect(formatCType(ptr(int("unsigned char", false, 8), true))).toBe("const unsigned char *");
  });
});

describe.skipIf(!clang)("C headers", () => {
  const header = () =>
    extractCHeader(path.join(fixtures, "gauge.h"), {
      includePaths: [path.join(fixtures, "include")],
    });

  it("lists the header's own functions with their parameters' names and types", () => {
    const { functions } = header();
    const fn = (name: string) => functions.find((f) => f.name === name);

    expect(functions.map((f) => f.name)).toEqual([
      "gauge_create",
      "gauge_destroy",
      "gauge_read",
      "gauge_total",
      "gauge_samples",
      "gauge_ready",
      "gauge_mode",
      "gauge_range",
      "gauge_each",
      "gauge_sum",
      "gauge_offset",
      "gauge_open",
    ]);
    expect(fn("gauge_create")).toEqual({
      name: "gauge_create",
      params: [
        { name: "scale", type: { k: "float", name: "double" } },
        { name: "error", type: ptr(record("GaugeError")) },
      ],
      result: ptr(record("Gauge")),
      variadic: false,
    });
    expect(fn("gauge_read")!.params.map((p) => [p.name, p.type])).toEqual([
      ["gauge", ptr(record("Gauge"))],
      ["input", ptr(int("unsigned char", false, 8), true)],
      ["input_length", int("unsigned long", false, 64)],
      ["output", ptr(int("unsigned char", false, 8))],
      ["output_length", int("unsigned long", false, 64)],
      ["error", ptr(record("GaugeError"))],
    ]);
  });

  it("resolves typedefs, from other headers too, to what C means", () => {
    const fn = (name: string) => header().functions.find((f) => f.name === name)!;

    expect(fn("gauge_total").result).toEqual(int(uint64Name(), false, 64));
    expect(fn("gauge_total").params[0]!.type).toEqual(ptr(record("Gauge"), true));
    expect(fn("gauge_samples").result).toEqual(int("unsigned int", false, 32));
    expect(fn("gauge_ready").result).toEqual({ k: "bool" });
    expect(fn("gauge_mode").result).toMatchObject({ k: "enum" });
    expect(fn("gauge_range").result).toEqual(record("GaugeRange"));
    expect(fn("gauge_each").params[1]!.type).toEqual({ k: "function" });
    expect(fn("gauge_sum").variadic).toBe(true);
    expect(fn("gauge_offset").params.map((p) => p.type)).toEqual([
      int("signed char", true, 8),
      int("unsigned short", false, 16),
      int("unsigned int", false, 32),
      int("unsigned long", false, 64),
    ]);
  });

  it("keeps a pointer typedef a pointer, and an unnamed type unknown", () => {
    const { functions, records } = header();
    const fn = (name: string) => functions.find((f) => f.name === name)!;

    expect(fn("gauge_open").result).toEqual(ptr(record("Gauge")));
    expect(records.find((r) => r.name === "Gauge")!.aliases).toEqual(["Gauge"]);
    expect(parseCType("enum (unnamed enum at gauge.h:40:22)")).toMatchObject({ k: "unknown" });
  });

  it("says which functions have C linkage when the header is read as C++", () => {
    const linkage = cLinkage(path.join(fixtures, "gauge.h"), {
      includePaths: [path.join(fixtures, "include")],
    });

    expect(linkage).toEqual({
      ok: true,
      functions: expect.arrayContaining(["gauge_create", "gauge_open"]),
    });
  });

  it("tells a header C++ cannot read, or that declares C++ functions, from one it can", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cxx-"));
    const write = (name: string, text: string) => {
      fs.writeFileSync(path.join(dir, name), text);
      return path.join(dir, name);
    };

    expect(cLinkage(write("keyword.h", "int kw(int new);\n"))).toEqual({
      ok: false,
      error: expect.stringMatching(/keyword\.h:1:.*new/),
    });
    expect(cLinkage(write("plain.h", "int plain(int n);\n"))).toEqual({ ok: true, functions: [] });
  });

  it("tells opaque records from complete ones, with their fields and typedef names", () => {
    const records = header().records;
    const rec = (name: string) => records.find((r) => r.name === name);

    expect(rec("Gauge")).toEqual({
      name: "Gauge",
      complete: false,
      fields: [],
      aliases: ["Gauge"],
    });
    expect(rec("GaugeError")).toEqual({
      name: "GaugeError",
      complete: true,
      fields: [
        { name: "code", type: int("int", true, 32) },
        { name: "message", type: ptr(int("char", true, 8), true) },
      ],
      aliases: ["GaugeError"],
    });
    expect(rec("GaugeRange")).toMatchObject({ complete: true, aliases: [] });
  });

  it("reports what clang reports for a header that does not compile", () => {
    expect(() => extractCHeader(path.join(fixtures, "gauge.h"))).toThrow(
      /gauge\.h: .*gauge_types\.h.*not found/s,
    );
  });
});
