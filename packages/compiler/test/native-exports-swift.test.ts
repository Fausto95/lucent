/**
 * The Swift API native code calls a module's exports through (decision
 * 0116): a `public enum` per module with its functions as static methods
 * and its classes as nested wrapper classes, `async` methods for async
 * exports, and LucentError for what Lucent code throws. Swift calls them
 * on the host: the generated Swift, compiled as the pod's module is, with
 * the entries' C header as its own, linked with the entries and the
 * runtime.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir } from "../src/index.ts";
import { swiftModuleName } from "../src/emit/swift-exports.ts";
import { compileAll } from "./parallel-build.ts";
import { schemaSet, setProgram } from "./schema-set.ts";
import { hostRuntime } from "./swift-harness.ts";
import { hostLibs } from "../../runtime/test/sources.ts";

const module = `export class Counter {
  count = 0;
  private total = 0;
  static created = 0;

  constructor(start: number) {
    this.total = start;
    Counter.created++;
  }

  get value(): number {
    return this.total;
  }

  set value(v: number) {
    this.total = v;
  }

  increment(by: number): number {
    this.count++;
    this.total += by;
    return this.total;
  }

  async settle(): Promise<string> {
    await Promise.resolve();
    return "settled at " + this.total;
  }

  static make(): Counter {
    return new Counter(100);
  }
}

export class Labelled extends Counter {
  constructor(public label: string) {
    super(1);
  }

  increment(by: number): number {
    return super.increment(by * 10);
  }
}

export function sum(cs: Counter[]): number {
  let n = 0;
  for (const c of cs) n += c.value;
  return n;
}

export function same(c: Counter): Counter {
  return c;
}

export function describe(c: Counter | null): string {
  return c === null ? "none" : "a counter of " + c.value;
}

export function tags(r: Record<string, number>): string[] {
  return Object.keys(r).map((k) => k + "=" + r[k]);
}

export function greet(name: string): string {
  if (name === "") throw new RangeError("no name");
  return "hi " + name;
}

export function reversed(b: Uint8Array, by: bigint): Uint8Array {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = (b[b.length - 1 - i] ?? 0) + Number(by);
  return out;
}

export function maybe(xs: (number | null)[]): number[] {
  return xs.map((x) => x ?? -1);
}

export function guarded(where: boolean): boolean {
  return !where;
}

export async function later(n: number): Promise<string> {
  await Promise.resolve();
  return "later " + n;
}

export async function rejects(): Promise<void> {
  await Promise.resolve();
  throw new TypeError("no");
}

let busy = false;
let turns = 0;

/** Throws when another call is running: calls from several threads take turns. */
export function take(spins: number): number {
  if (busy) throw new Error("overlapped");
  busy = true;
  let x = 0;
  for (let i = 0; i < spins; i++) x += i % 7;
  busy = false;
  turns++;
  return x;
}

export function taken(): number {
  return turns;
}
`;

/** Swift calling the module, as an app's would: compiled into the module, it imports nothing of it. */
const probe = `import Foundation

func run() async -> [String] {
  var lines: [String] = []
  do {
    let c = try Counters.Counter(start: 1)
    lines.append("increment \\(try c.increment(by: 2))")
    try c.setValue(10)
    lines.append("value \\(try c.value), count \\(try c.count), created \\(try Counters.Counter.created)")
    let made = try Counters.Counter.make()
    lines.append("sum \\(try Counters.sum(cs: [c, made])), \\(try Counters.describe(c: nil)), \\(try Counters.describe(c: made))")
    lines.append("tags \\(try Counters.tags(r: ["b": 2, "a": 1]).sorted())")
    let l = try Counters.Labelled(label: "x")
    lines.append("labelled \\(try l.increment(by: 2)) \\(try l.label) \\(try Counters.sum(cs: [l]))")
    lines.append("same \\(try Counters.same(c: l) is Counters.Labelled) \\(try Counters.same(c: c) is Counters.Labelled)")
    lines.append("bytes \\([UInt8](try Counters.reversed(b: Data([1, 2, 3]), by: 10))) \\(try Counters.maybe(xs: [1, nil])) \\(try Counters.guarded(where: true))")
    do {
      _ = try Counters.greet(name: "")
    } catch let e as LucentError {
      lines.append("threw \\(e), code \\(e.code.isEmpty ? "none" : e.code)")
    }
    lines.append("await \\(try await Counters.later(n: 4)), \\(try await c.settle())")
    do {
      try await Counters.rejects()
    } catch let e as LucentError {
      lines.append("rejected \\(e.name): \\(e.message)")
    }
    // Tasks on several threads call at once: each call holds the module's actor.
    let overlapped = await withTaskGroup(of: Int.self) { group in
      for _ in 0..<8 {
        group.addTask {
          var failed = 0
          for _ in 0..<25 {
            do { _ = try Counters.take(spins: 20000) } catch { failed += 1 }
          }
          return failed
        }
      }
      var failed = 0
      for await f in group { failed += f }
      return failed
    }
    lines.append("turns \\(try Counters.taken()), \\(overlapped) overlapped")
    // c holds module state until here, so the count lasts.
    withExtendedLifetime(c) {}
  } catch {
    lines.append("failed \\(error)")
  }
  return lines
}

@main struct Probe {
  static func main() async {
    // The wrappers have gone when run returns: so has what held module state.
    for line in await run() { print(line) }
    print("holds \\(probe_holds())")
  }
}
`;

const holds = `#include <lucent/native_root.h>

extern "C" int probe_holds(void) { return (int)lucent::moduleStateHolds(); }
`;

const has = (cmd: string) => spawnSync(cmd, ["--version"]).status === 0;
const tools = has("swiftc") && has("clang++");

/** Builds the program's entries with the probe and the host runtime, and runs it. */
function run(dir: string, files: ReadonlyMap<string, string>) {
  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  for (const [name, text] of files) fs.writeFileSync(path.join(out, name), text);
  fs.writeFileSync(path.join(out, "holds.cpp"), holds);
  fs.writeFileSync(path.join(out, "probe.swift"), probe);
  // The module's C, as the pod's umbrella header gives its Swift: the entries' header.
  fs.writeFileSync(
    path.join(out, "bridge.h"),
    '#include "lucent_entries.h"\n\nint probe_holds(void);\n',
  );

  const cppDir = path.join(runtimeDir(), "cpp");
  const units = [...files.keys()]
    .filter((f) => f.endsWith(".cpp") && f !== "lucent_bindings.cpp" && f !== "lucent_identity.cpp")
    .concat("holds.cpp");
  const jobs = units.map((f) => ({
    cmd: "clang++",
    args: [
      "-std=c++20",
      "-ffp-contract=off",
      "-O1",
      `-I${cppDir}`,
      `-I${out}`,
      "-c",
      path.join(out, f),
    ],
    object: path.join(out, `${f}.o`),
  }));
  const printed = compileAll(jobs);
  expect(jobs.filter((j) => !fs.existsSync(j.object)).map(() => printed)).toEqual([]);

  const exe = path.join(dir, "probe");
  const swiftc = spawnSync(
    "swiftc",
    [
      // As the pod builds it (s.swift_version), its warnings errors here.
      "-swift-version",
      "5",
      "-warnings-as-errors",
      "-parse-as-library",
      "-module-name",
      "LucentNative",
      "-Xcc",
      `-I${cppDir}`,
      "-import-objc-header",
      path.join(out, "bridge.h"),
      path.join(out, "LucentExports.swift"),
      path.join(out, "probe.swift"),
      ...jobs.map((j) => j.object),
      hostRuntime(),
      process.platform === "darwin" ? "-lc++" : "-lstdc++",
      "-lpthread",
      ...hostLibs,
      "-o",
      exe,
    ],
    { encoding: "utf8" },
  );
  expect(swiftc.stderr).toBe("");

  return spawnSync(exe, [], { encoding: "utf8" });
}

describe("the Swift API of a module's exports", () => {
  it("names a module's enum from its path", () => {
    expect(swiftModuleName("lucent-sync/workers")).toBe("LucentSyncWorkers");
    expect(swiftModuleName("counters")).toBe("Counters");
    expect(swiftModuleName("my_mod")).toBe("MyMod");
    expect(swiftModuleName("2d")).toBeUndefined();
  });

  it("gives no Swift API to modules whose Swift names come out the same, and warns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-exports-swift-"));
    fs.writeFileSync(
      path.join(dir, "a_b.lucent.ts"),
      "export function c(): number {\n  return 1;\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, "aB.lucent.ts"),
      "export function d(): number {\n  return 2;\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, "e.lucent.ts"),
      "export function f(): number {\n  return 3;\n}\n",
    );
    const r = compile(["a_b", "aB", "e"].map((m) => path.join(dir, `${m}.lucent.ts`)));

    expect(r.diagnostics).toEqual([]);
    expect(r.warnings?.map((w) => [w.code, w.message])).toEqual([
      [
        "LUCENT3017",
        "modules a_b and aB would have the same Swift name, AB: neither gets a Swift API",
      ],
    ]);
    const api = r.files.get("LucentExports.swift")!;
    expect(api).toContain("public enum E {");
    expect(api).not.toContain("enum AB");
    // Their entries stay, for C and Kotlin.
    expect(r.files.get("lucent_entries.h")).toContain("lucent_a_b_c");
    expect(r.files.get("lucent_entries.h")).toContain("lucent_aB_d");
  });

  it("writes no Swift API for a program whose exports have no entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-exports-swift-"));
    fs.writeFileSync(
      path.join(dir, "o.lucent.ts"),
      "export function f(o: { a: number }): number {\n  return o.a;\n}\n",
    );
    const r = compile([path.join(dir, "o.lucent.ts")]);
    expect(r.diagnostics).toEqual([]);
    expect(r.files.has("LucentExports.swift")).toBe(false);
  });

  it("types platform objects as their SDK classes, importing their modules", () => {
    const set = schemaSet([
      {
        module: "Kit",
        frameworks: ["Kit"],
        types: [{ kind: "class", name: "KITThing", native: "KITThing", methods: [] }],
      },
    ]);
    const p = setProgram(
      `import { KITThing } from "lucent:ios/Kit";\nexport async function run(): Promise<string> {\n  return "";\n}\nexport function pick(ts: KITThing[]): KITThing | null {\n  return ts[0] ?? null;\n}\n`,
      set,
    );
    expect(p.messages).toEqual([]);
    const api = p.r.files.get("ios/LucentExports.swift")!;
    expect(api).toMatch(/^import Foundation\nimport Kit$/m);
    expect(api).toContain("public static func pick(ts: [Kit.KITThing]) throws -> Kit.KITThing? {");
    expect(api).toContain("lucentArena.array(ts, { lucentArena.object($0) })");
    expect(api).toContain(
      "LucentOut.optional(lucentResult, { LucentOut.object($0) as Kit.KITThing })",
    );
    // No Swift API in Android's, which has its Kotlin one.
    expect(p.r.files.has("android/LucentExports.swift")).toBe(false);
  });

  it.skipIf(!tools)(
    "calls functions, makes and uses instances, awaits, and catches what Lucent throws",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-exports-swift-"));
      fs.writeFileSync(path.join(dir, "counters.lucent.ts"), module);
      const r = compile([path.join(dir, "counters.lucent.ts")]);
      expect(r.diagnostics.map((d) => d.message)).toEqual([]);

      const api = r.files.get("LucentExports.swift")!;
      expect(api).toContain("public enum Counters {");
      expect(api).toContain(
        "public static func sum(cs: [LucentNative.Counters.Counter]) throws -> Swift.Double {",
      );
      expect(api).toContain(
        "public static func later(n: Swift.Double) async throws -> Swift.String {",
      );
      expect(api).toContain(
        "public class Counter: LucentNative.LucentInstance, @unchecked Swift.Sendable {",
      );
      expect(api).toContain(
        "public final class Labelled: LucentNative.Counters.Counter, @unchecked Swift.Sendable {",
      );
      expect(api).toContain(
        "override public func increment(by: Swift.Double) throws -> Swift.Double {",
      );
      expect(api).toContain("public var value: Swift.Double {\n      get throws {");
      expect(api).toContain("public func setValue(_ value: Swift.Double) throws {");
      // A Swift keyword, escaped.
      expect(api).toContain(
        "public static func guarded(`where`: Swift.Bool) throws -> Swift.Bool {",
      );

      expect(run(dir, r.files)).toEqual(
        expect.objectContaining({
          status: 0,
          stdout: [
            "increment 3.0",
            "value 10.0, count 1.0, created 1.0",
            "sum 110.0, none, a counter of 100",
            'tags ["a=1", "b=2"]',
            "labelled 21.0 x 21.0",
            "same true false",
            "bytes [13, 12, 11] [1.0, -1.0] false",
            "threw RangeError: no name, code none",
            "await later 4, settled at 10",
            "rejected TypeError: no",
            "turns 200.0, 0 overlapped",
            "holds 0",
            "",
          ].join("\n"),
          stderr: "",
        }),
      );
    },
    600_000,
  );
});
