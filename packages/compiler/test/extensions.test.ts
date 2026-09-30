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
import { uint64Name } from "../../bindgen/test/c-types.ts";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/orbit-filter");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

/** The fixture package, copied, with its extension's declaration changed by `edit`, and its header by `header`. */
function orbit(
  edit: (declaration: Record<string, any>) => void = () => {},
  header: (text: string) => string = (text) => text,
): LucentPackage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-"));
  fs.cpSync(fixture, dir, { recursive: true });

  const h = path.join(dir, "native/orbit_filter.h");
  fs.writeFileSync(h, header(fs.readFileSync(h, "utf8")));

  const file = path.join(dir, "lucent.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(json.extensions["orbit-filter"]);
  fs.writeFileSync(file, JSON.stringify(json));

  return { name: "lucent-orbit-filter", version: "1.0.0", dir, sources: path.join(dir, "src") };
}

const bind = (p: LucentPackage) => bindExtensions(resolveNative([p]).extensions);

/** The error binding `edit`'s declaration (and `header`'s header) fails with. */
const failure =
  (edit: (declaration: Record<string, any>) => void, header?: (text: string) => string) => () =>
    bind(orbit(edit, header));

/** The header with `decl` added before its closing extern "C" guard. */
const adding = (decl: string) => (text: string) =>
  text.replace("#ifdef __cplusplus\n}", `${decl}\n\n#ifdef __cplusplus\n}`);

describe.skipIf(!clang)("binding a native extension", () => {
  it("binds its handles, functions and errors against the header's declarations", () => {
    const [ext] = bind(orbit());

    expect(ext).toMatchObject({
      name: "orbit-filter",
      package: "lucent-orbit-filter",
      include: "orbit_filter.h",
    });

    const filter = ext!.handles.find((h) => h.name === "OrbitFilter")!;
    expect(filter.create.name).toBe("orbit_filter_create");
    expect(filter.destroy).toBe("orbit_filter_destroy");
    expect(filter.methods.map((m) => [m.name, m.fn.name])).toEqual([
      ["apply", "orbit_filter_apply"],
      ["processed", "orbit_filter_processed"],
    ]);
    expect(filter.affinity).toBe("any");

    const apply = ext!.functions.find((f) => f.name === "orbit_filter_apply")!;
    expect(apply.params.map((p) => p.kind)).toEqual([
      "handle",
      "bytes",
      "length",
      "bytes",
      "length",
      "error",
    ]);
    expect(apply.result).toEqual({ kind: "number", c: "int" });
    expect(apply.failsWhen).toBe("negative");

    // Scalars need no declaration; 64-bit integers are bigints.
    const processed = ext!.functions.find((f) => f.name === "orbit_filter_processed")!;
    expect(processed.result).toEqual({ kind: "bigint", c: uint64Name() });

    // A function with a callback is left out, with the reason.
    expect(ext!.functions.some((f) => f.name === "orbit_filter_each")).toBe(false);
    expect(ext!.skipped).toEqual([
      "orbit_filter_each: parameter visit is a function pointer; extensions cannot take callbacks yet",
    ]);
    // Destroying is the handle's close(), never a function Lucent code calls.
    expect(ext!.functions.some((f) => f.name === "orbit_filter_destroy")).toBe(false);
  });

  it("fails for a name the header does not declare, naming the field", () => {
    expect(
      failure((d) => {
        d.functions.orbit_filter_aply = d.functions.orbit_filter_apply;
        delete d.functions.orbit_filter_apply;
      }),
    ).toThrow(
      "lucent-orbit-filter/lucent.json: extensions.orbit-filter.functions.orbit_filter_aply: orbit_filter.h declares no function orbit_filter_aply",
    );
    expect(failure((d) => (d.handles.OrbitFilter.destroy = "orbit_filter_free"))).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.destroy: orbit_filter.h declares no function orbit_filter_free",
    );
    expect(failure((d) => (d.handles.Orbit = d.handles.OrbitFilter))).toThrow(
      "extensions.orbit-filter.handles.Orbit: orbit_filter.h declares no struct Orbit",
    );
  });

  it("needs a handle's type opaque, and its functions to take and give it", () => {
    expect(
      failure((d) => {
        d.handles.OrbitError = d.handles.OrbitFilter;
        delete d.handles.OrbitFilter;
      }),
    ).toThrow(
      "extensions.orbit-filter.handles.OrbitError: OrbitError is defined in orbit_filter.h; a handle's struct must be opaque (declared, not defined), so Lucent never reads its fields",
    );
    expect(failure((d) => (d.handles.OrbitFilter.destroy = "orbit_filter_live"))).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.destroy: orbit_filter_live must be void orbit_filter_live(OrbitFilter *)",
    );
    expect(failure((d) => (d.handles.OrbitFilter.create = "orbit_filter_live"))).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.create: orbit_filter_live must return OrbitFilter *",
    );
    expect(failure((d) => (d.handles.OrbitFilter.methods.count = "orbit_filter_live"))).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.methods.count: orbit_filter_live must take OrbitFilter * first",
    );
    expect(
      failure((d) => (d.handles.OrbitFilter.methods.close = "orbit_filter_processed")),
    ).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.methods.close: close is the handle's own method",
    );
  });

  it("never lets Lucent code call a destroy or release but through close()", () => {
    expect(failure((d) => (d.handles.OrbitFilter.methods.free = "orbit_filter_destroy"))).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.methods.free: orbit_filter_destroy destroys a handle: close() calls it",
    );
  });

  it("needs a create to return a pointer it may destroy", () => {
    expect(
      failure(
        () => {},
        (h) =>
          h.replace("OrbitFilter* orbit_filter_create(", "const OrbitFilter* orbit_filter_create("),
      ),
    ).toThrow(
      "extensions.orbit-filter.handles.OrbitFilter.create: orbit_filter_create returns const OrbitFilter *; a handle's create must return OrbitFilter *",
    );
  });

  it("binds a function that takes a handle only when the declaration names it", () => {
    const [ext] = bind(orbit(() => {}, adding("void orbit_filter_reset(OrbitFilter* filter);")));

    expect(ext!.functions.some((f) => f.name === "orbit_filter_reset")).toBe(false);
    expect(ext!.skipped).toContain(
      "orbit_filter_reset: it takes a handle (OrbitFilter *): name it in functions or as a method, so Lucent knows it neither keeps nor frees it",
    );
  });

  it('needs the header\'s functions in extern "C" when C++ includes it', () => {
    expect(
      failure(
        () => {},
        (h) =>
          h
            .replace('#ifdef __cplusplus\nextern "C" {\n#endif', "")
            .replace("#ifdef __cplusplus\n}\n#endif", ""),
      ),
    ).toThrow(
      'extensions.orbit-filter.header: orbit_filter.h declares orbit_filter_create without C linkage when C++ includes it: wrap its declarations in #ifdef __cplusplus extern "C" { … } #endif',
    );
    expect(failure(() => {}, adding("int32_t orbit_filter_kw(int32_t new);"))).toThrow(
      /extensions\.orbit-filter\.header: orbit_filter\.h does not compile as C\+\+: .*orbit_filter\.h:\d+:.*new/s,
    );
  });

  it("checks pointer parameters against what they are declared as", () => {
    expect(
      failure((d) => (d.functions.orbit_filter_apply.params.input.length = "input_size")),
    ).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply.params.input.length: orbit_filter_apply has no parameter input_size",
    );
    expect(failure((d) => (d.functions.orbit_filter_apply.params.input.length = "output"))).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply.params.input.length: output is unsigned char *, not an integer",
    );
    expect(
      failure(
        (d) =>
          (d.functions.orbit_filter_apply.params.input = {
            bytes: "write",
            length: "input_length",
          }),
      ),
    ).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply.params.input: bytes written through a const pointer (const unsigned char *)",
    );
    expect(failure((d) => delete d.functions.orbit_filter_apply.params.output)).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply: parameter output is a pointer (unsigned char *): declare it in params as bytes, a string or an error",
    );
    expect(
      failure((d) => (d.functions.orbit_filter_label.params.name = { error: "OrbitError" })),
    ).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_label.params.name: an error parameter must point to OrbitError, not const char *",
    );
    expect(failure((d) => delete d.errors.OrbitError)).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_create.params.error: extensions.orbit-filter.errors does not declare OrbitError",
    );
  });

  it("checks results against how they say a call failed", () => {
    expect(failure((d) => (d.functions.orbit_filter_apply.failsWhen = "null"))).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply.failsWhen: null needs a pointer result; orbit_filter_apply returns int",
    );
    expect(
      failure((d) => (d.functions.orbit_filter_processed = { failsWhen: "negative" })),
    ).toThrow(
      `extensions.orbit-filter.functions.orbit_filter_processed.failsWhen: negative needs a signed result; orbit_filter_processed returns ${uint64Name()}`,
    );
    expect(failure((d) => delete d.functions.orbit_filter_apply.failsWhen)).toThrow(
      "extensions.orbit-filter.functions.orbit_filter_apply: error fills in OrbitError when the call fails: declare failsWhen, how its result says so",
    );
    expect(failure((d) => (d.errors.OrbitError.message = "code"))).toThrow(
      "extensions.orbit-filter.errors.OrbitError.message: OrbitError.code is int, not const char *",
    );
  });
});

describe.skipIf(!clang)("an extension's declarations", () => {
  it("give Lucent code its handles as classes, and its functions", () => {
    const dts = extensionDts(bind(orbit())[0]!);

    expect(dts).toContain("export declare class OrbitFilter {");
    expect(dts).toContain("constructor(strength: number);");
    expect(dts).toContain("apply(input: Uint8Array, output: Uint8Array): number;");
    expect(dts).toContain("processed(): bigint;");
    expect(dts).toContain("close(): void;");
    expect(dts).toContain("[Symbol.dispose](): void;");
    expect(dts).toContain(
      "export declare function orbit_filter_apply(filter: OrbitFilter, input: Uint8Array, output: Uint8Array): number;",
    );
    expect(dts).toContain("export declare function orbit_filter_live(): number;");
    expect(dts).toContain("export declare function orbit_filter_label(name: string): number;");
    expect(dts).not.toContain("orbit_filter_destroy");
    expect(dts).toContain("orbit_filter_each: parameter visit is a function pointer");
  });

  it("type-check on their own, without skipLibCheck", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-dts-"));
    const file = path.join(dir, "orbit-filter.d.ts");
    fs.writeFileSync(file, extensionDts(bind(orbit())[0]!));

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

describe.skipIf(!clang)("compiling code that uses an extension", () => {
  const source = (text: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-src-"));
    const file = path.join(dir, "use.lucent.ts");
    fs.writeFileSync(file, text);
    return file;
  };

  const extensions = (): ExtensionBinding[] => bind(orbit());

  it("calls the C functions from shared code, converting and checking what crosses", () => {
    const r = compile([path.join(fixture, "src/filter.lucent.ts")], { extensions: extensions() });

    expect(r.diagnostics).toEqual([]);

    const cpp = [...r.files]
      .filter(([f]) => f.endsWith(".cpp"))
      .map(([, text]) => text)
      .join("\n");
    expect(cpp).toContain('#include "orbit_filter.h"');
    expect(cpp).toContain("orbit_filter_create(");
    expect(cpp).toContain("orbit_filter_apply(");
    expect(cpp).toContain("orbit_filter_destroy");
    // The declarations editors and tsc read, next to the SDK modules'.
    expect(r.types?.get("ext/orbit-filter.d.ts")).toContain("export declare class OrbitFilter");
  });

  it("keeps handles on the Lucent side of the JavaScript boundary", () => {
    const r = compile(
      [
        source(
          'import { OrbitFilter } from "lucent:ext/orbit-filter";\nexport function make(): OrbitFilter { return new OrbitFilter(1); }\n',
        ),
      ],
      { extensions: extensions() },
    );

    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toMatch(
      /OrbitFilter is a handle of the native extension orbit-filter; handles cannot cross the JavaScript boundary/,
    );
  });

  it("says which extensions exist when one is missing", () => {
    const r = compile(
      [
        source(
          'import { Nope } from "lucent:ext/nope";\nexport function f(): number { return 1; }\n',
        ),
      ],
      { extensions: extensions() },
    );

    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.message).join("\n")).toMatch(
      /lucent:ext\/nope: no Lucent package declares the extension nope \(the app's extensions: orbit-filter\)/,
    );
  });

  it("requires main-thread handles and functions to be used in main()", () => {
    const main = bindExtensions(
      resolveNative([orbit((d) => (d.handles.OrbitFilter.affinity = "main"))]).extensions,
    );
    const r = compile(
      [
        source(
          'import { OrbitFilter } from "lucent:ext/orbit-filter";\nexport function f(): number { const o = new OrbitFilter(1); o.close(); return 1; }\n',
        ),
      ],
      { extensions: main },
    );

    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toMatch(
      /OrbitFilter can only be used on the main thread: call it inside main\(\(\) => …\) from lucent:thread/,
    );
  });
});
