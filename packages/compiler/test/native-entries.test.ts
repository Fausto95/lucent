/**
 * Native entry points (decision 0091): C functions that run a module's
 * exports with no JavaScript runtime, through the native root. Built for
 * the host with the runtime and called from C++: they start module state,
 * pass what crosses, give an error to the caller, and an async one calls
 * its completion once.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";
import { compileAll } from "./parallel-build.ts";
import { hostRuntime } from "./swift-harness.ts";
import { hostLibs } from "../../runtime/test/sources.ts";

const module = `import { onDestroy } from "lucent:core";

let calls = 0;
const greeting = "hi " + "there";
const stopHook = onDestroy(() => {});

export function add(a: number, b: number): number {
  calls++;
  return a + b;
}

export function greet(name: string): string {
  calls++;
  return greeting + ", " + name;
}

export function count(): bigint {
  return BigInt(calls);
}

export function reversed(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i] ?? 0;
  return out;
}

export function fail(why: string): void {
  throw new RangeError(why);
}

export async function later(n: number): Promise<string> {
  await Promise.resolve();
  calls++;
  return "later " + n;
}

export async function rejects(): Promise<void> {
  throw new TypeError("no");
}

// No entry: an optional parameter, and an object.
export function optional(x?: number): number {
  return x ?? 0;
}

export function objects(o: { a: number }): number {
  return o.a;
}
`;

const main = `#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "lucent_entries.h"
#include <lucent/native_root.h>

static std::string text(lucent_string s) { return std::string(s.data, s.length); }

static std::atomic<int> settled{0};
static std::string later;
static std::string rejected;

int main() {
  std::printf("generation %d\\n", (int)lucent::moduleGeneration());

  lucent_error error{};
  double sum = 0;
  bool ok = lucent_math_add(2, 3, &error, &sum);
  std::printf("add %d %g, generation %s\\n", ok, sum, lucent::moduleGeneration() ? "started" : "none");

  lucent_string greeting{};
  const char* name = "Lucent";
  lucent_math_greet(lucent_string{name, 6}, &error, &greeting);
  std::printf("greet %s\\n", text(greeting).c_str());

  int64_t calls = 0;
  lucent_math_count(&error, &calls);
  std::printf("count %lld\\n", (long long)calls);

  const uint8_t bytes[] = {1, 2, 3};
  lucent_bytes back{};
  lucent_math_reversed(lucent_bytes{bytes, 3}, &error, &back);
  std::printf("reversed %d%d%d\\n", back.data[0], back.data[1], back.data[2]);

  ok = lucent_math_fail(lucent_string{"too far", 7}, &error);
  std::printf("fail %d %s: %s\\n", ok, text(error.name).c_str(), text(error.message).c_str());

  lucent_math_later(4, [](void*, const lucent_string* result, const lucent_error*) {
    later = result ? text(*result) : "error";
    settled++;
  }, nullptr);
  lucent_math_rejects([](void*, const lucent_error* e) {
    rejected = e ? text(e->name) + ": " + text(e->message) : "fulfilled";
    settled++;
  }, nullptr);
  for (int i = 0; i < 400 && settled < 2; i++) std::this_thread::sleep_for(std::chrono::milliseconds(5));
  std::printf("later %s, rejects %s\\n", later.c_str(), rejected.c_str());

  lucent_math_count(&error, &calls);
  std::printf("count %lld, holds %d\\n", (long long)calls, (int)lucent::moduleStateHolds());
  return 0;
}
`;

// Optionals, arrays and records (decision 0116): lucent_values.
const lists = `export function total(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum;
}

export function names(r: Record<string, number>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(r)) out.push(k + "=" + r[k]);
  return out;
}

export function maybe(n: number | null): string | null {
  return n === null ? null : "n=" + n;
}

export function lengths(rows: (string | null)[][]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  rows.forEach((row, i) => {
    out["row" + i] = row.every((x) => x !== null);
  });
  return out;
}

export async function tags(n: number): Promise<string[]> {
  await Promise.resolve();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push("t" + i);
  return out;
}
`;

const listsMain = `#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "lucent_entries.h"

static std::string text(lucent_string s) { return std::string(s.data, s.length); }
static lucent_value number(double d) {
  lucent_value v{LUCENT_NUMBER, {}};
  v.as.number = d;
  return v;
}
static lucent_value string(const char* s) {
  lucent_value v{LUCENT_STRING, {}};
  v.as.string = lucent_string{s, std::char_traits<char>::length(s)};
  return v;
}
static lucent_value array(const lucent_value* items, size_t n) {
  lucent_value v{LUCENT_ARRAY, {}};
  v.as.array = lucent_array{items, n};
  return v;
}
static std::string show(const lucent_value& v) {
  switch (v.kind) {
    case LUCENT_NULL: return "null";
    case LUCENT_BOOLEAN: return v.as.boolean ? "true" : "false";
    case LUCENT_NUMBER: return std::to_string((int)v.as.number);
    case LUCENT_STRING: return text(v.as.string);
    case LUCENT_ARRAY: {
      std::string out = "[";
      for (size_t i = 0; i < v.as.array.length; i++) out += (i ? " " : "") + show(v.as.array.items[i]);
      return out + "]";
    }
    case LUCENT_RECORD: {
      std::string out = "{";
      for (size_t i = 0; i < v.as.record.length; i++)
        out += (i ? " " : "") + text(v.as.record.keys[i]) + ":" + show(v.as.record.values[i]);
      return out + "}";
    }
    default: return "?";
  }
}

static std::atomic<int> settled{0};
static std::string tagged;

int main() {
  lucent_error error{};
  const lucent_value xs[] = {number(1), number(2), number(3)};
  double sum = 0;
  lucent_lists_total(array(xs, 3), &error, &sum);
  std::printf("total %g\\n", sum);

  const lucent_value wrong[] = {number(1), string("two")};
  bool ok = lucent_lists_total(array(wrong, 2), &error, &sum);
  std::printf("wrong %d %s: %s\\n", ok, text(error.name).c_str(), text(error.message).c_str());

  const lucent_string keys[] = {{"b", 1}, {"a", 1}};
  const lucent_value values[] = {number(2), number(1)};
  lucent_value record{LUCENT_RECORD, {}};
  record.as.record = lucent_record{keys, values, 2};
  lucent_value out{};
  lucent_lists_names(record, &error, &out);
  std::printf("names %s\\n", show(out).c_str());

  lucent_lists_maybe(lucent_value{LUCENT_NULL, {}}, &error, &out);
  std::printf("maybe %s", show(out).c_str());
  lucent_lists_maybe(number(4), &error, &out);
  std::printf(" %s\\n", show(out).c_str());

  const lucent_value full[] = {string("a"), string("b")};
  const lucent_value holed[] = {string("a"), lucent_value{LUCENT_NULL, {}}};
  const lucent_value rows[] = {array(full, 2), array(holed, 2)};
  lucent_lists_lengths(array(rows, 2), &error, &out);
  std::printf("lengths %s\\n", show(out).c_str());

  lucent_lists_tags(3, [](void*, const lucent_value* result, const lucent_error*) {
    tagged = result ? show(*result) : "error";
    settled++;
  }, nullptr);
  for (int i = 0; i < 400 && settled < 1; i++) std::this_thread::sleep_for(std::chrono::milliseconds(5));
  std::printf("tags %s\\n", tagged.c_str());
  return 0;
}
`;

const tasks = `let pendingAtLaunch = 3;

export function pending(): number {
  return pendingAtLaunch;
}
`;

const launchMain = `#include <cstdio>

#include "lucent_entries.h"
#include <lucent/native_root.h>

int main() {
  std::printf("generation %s, holds %d\\n", lucent::moduleGeneration() ? "started" : "none", (int)lucent::moduleStateHolds());
  lucent_launch();
  auto generation = lucent::moduleGeneration();
  std::printf("launched: generation %s, holds %d\\n", generation ? "started" : "none", (int)lucent::moduleStateHolds());
  lucent_launch();
  lucent_error error{};
  double pending = 0;
  lucent_lucent_tasks_tasks_pending(&error, &pending);
  std::printf("again: same %d, holds %d, pending %g\\n", lucent::moduleGeneration() == generation, (int)lucent::moduleStateHolds(), pending);
  return 0;
}
`;

const clangxx = spawnSync("clang++", ["--version"]).status === 0;

/** Builds `files` (a compile's) with `main` and the host runtime, JSI-free units only, and runs it. */
function run(dir: string, files: ReadonlyMap<string, string>, main: string) {
  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  for (const [name, text] of files) fs.writeFileSync(path.join(out, name), text);
  fs.writeFileSync(path.join(out, "main.cpp"), main);

  // Everything but the JSI units: no JavaScript runtime is linked.
  const units = [...files.keys()]
    .filter((f) => f.endsWith(".cpp") && f !== "lucent_bindings.cpp" && f !== "lucent_identity.cpp")
    .concat("main.cpp");
  const jobs = units.map((f) => ({
    cmd: "clang++",
    args: [
      "-std=c++20",
      "-ffp-contract=off",
      "-O1",
      `-I${path.join(runtimeDir(), "cpp")}`,
      `-I${out}`,
      "-c",
      path.join(out, f),
    ],
    object: path.join(out, `${f}.o`),
  }));
  const printed = compileAll(jobs);
  expect(jobs.filter((j) => !fs.existsSync(j.object)).map(() => printed)).toEqual([]);

  const exe = path.join(dir, "entries");
  const link = spawnSync(
    "clang++",
    // CoreFoundation on macOS: the runtime's locale-aware strings use it.
    [...jobs.map((j) => j.object), hostRuntime(), "-lpthread", ...hostLibs, "-o", exe],
    { encoding: "utf8" },
  );
  expect(link.stderr).toBe("");

  return spawnSync(exe, [], { encoding: "utf8" });
}

describe.skipIf(!clangxx)("native entry points", () => {
  it("give no entry point to exports whose names come out the same, and warn", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-"));
    fs.writeFileSync(
      path.join(dir, "a_b.lucent.ts"),
      "export function c(): number {\n  return 1;\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, "a.lucent.ts"),
      "export function b_c(): number {\n  return 2;\n}\nexport function d(): number {\n  return 3;\n}\n",
    );
    const r = compile([path.join(dir, "a.lucent.ts"), path.join(dir, "a_b.lucent.ts")], {
      platforms: ["host"],
    });
    expect(r.diagnostics).toEqual([]);
    expect((r.warnings ?? []).map((d) => `${d.code} ${d.message}`)).toEqual([
      "LUCENT3016 a.b_c and a_b.c would have the same native entry point, lucent_a_b_c: neither gets one",
    ]);
    const header = r.files.get("lucent_entries.h")!;
    expect(header).not.toContain("lucent_a_b_c");
    expect(header).toContain("bool lucent_a_d(lucent_error* error, double* result);");
  });

  it("undefine the program's names as macros around the entries", () => {
    // Apple's AssertMacros.h defines check(assertion) as a macro.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-"));
    fs.writeFileSync(
      path.join(dir, "probe.lucent.ts"),
      "export function check(n: number): number {\n  return n;\n}\n",
    );
    const r = compile([path.join(dir, "probe.lucent.ts")], { platforms: ["host"] });
    expect(r.diagnostics).toEqual([]);
    const unit = r.files.get("lucent_entries.cpp")!;
    const at = (text: string) => unit.indexOf(text);
    expect(at('#pragma push_macro("check")\n#undef check')).toBeGreaterThan(0);
    expect(at("lucent_app::m_probe::check(")).toBeGreaterThan(at("#undef check"));
    expect(at('#pragma pop_macro("check")')).toBeGreaterThan(at("lucent_app::m_probe::check("));
  });

  it("run module functions with no JavaScript runtime, and give their errors to the caller", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-"));
    fs.writeFileSync(path.join(dir, "math.lucent.ts"), module);
    const r = compile([path.join(dir, "math.lucent.ts")], { platforms: ["host"] });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    const header = r.files.get("lucent_entries.h")!;
    expect(header).toContain(
      "/// math.add(a, b)\nbool lucent_math_add(double arg0, double arg1, lucent_error* error, double* result);",
    );
    expect(header).toContain(
      "void lucent_math_later(double arg0, void (*done)(void* context, const lucent_string* result, const lucent_error* error), void* context);",
    );
    expect(header).not.toContain("lucent_math_optional");
    expect(header).not.toContain("lucent_math_objects");
    expect(r.files.get("lucent_bindings.cpp")).toContain("lucent_app::initModules();");
    // No package lists launch modules: launching does nothing.
    expect(header).toContain("void lucent_launch(void);");
    expect(r.files.get("lucent_entries.cpp")).toContain('extern "C" void lucent_launch(void) {}');

    const ran = run(dir, r.files, main);
    expect(ran.stdout).toBe(
      [
        "generation 0",
        "add 1 5, generation started",
        "greet hi there, Lucent",
        "count 2",
        "reversed 321",
        "fail 0 RangeError: too far",
        "later later 4, rejects TypeError: no",
        "count 3, holds 0",
        "",
      ].join("\n"),
    );
    expect(ran.status).toBe(0);
  }, 300_000);

  it("pass optionals, arrays and records as lucent_values, checking their kinds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-"));
    fs.writeFileSync(path.join(dir, "lists.lucent.ts"), lists);
    const r = compile([path.join(dir, "lists.lucent.ts")], { platforms: ["host"] });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    const header = r.files.get("lucent_entries.h")!;
    expect(header).toContain(
      "bool lucent_lists_total(lucent_value arg0, lucent_error* error, double* result);",
    );
    expect(header).toContain(
      "bool lucent_lists_maybe(lucent_value arg0, lucent_error* error, lucent_value* result);",
    );
    expect(header).toContain(
      "void lucent_lists_tags(double arg0, void (*done)(void* context, const lucent_value* result, const lucent_error* error), void* context);",
    );

    const ran = run(dir, r.files, listsMain);
    expect(ran.stdout).toBe(
      [
        "total 6",
        "wrong 0 TypeError: A native entry was given a string where it takes a number",
        "names [b=2 a=1]",
        "maybe null n=4",
        "lengths {row0:true row1:false}",
        "tags [t0 t1 t2]",
        "",
      ].join("\n"),
    );
    expect(ran.status).toBe(0);
  }, 300_000);

  it("start module state at launch for a package's launch modules, and hold it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-launch-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "lucent-tasks", version: "1.0.0", lucent: {} }),
    );
    fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify({ launch: ["tasks"] }));
    fs.writeFileSync(path.join(dir, "tasks.lucent.ts"), tasks);
    const r = compile([path.join(dir, "tasks.lucent.ts")], { platforms: ["host"] });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.files.get("lucent_entries.cpp")).toContain("// Launch modules: lucent-tasks/tasks.");

    const ran = run(dir, r.files, launchMain);
    expect(ran.stdout).toBe(
      [
        "generation none, holds 0",
        "launched: generation started, holds 1",
        "again: same 1, holds 1, pending 3",
        "",
      ].join("\n"),
    );
    expect(ran.status).toBe(0);
  }, 300_000);

  it("start the app's own launch modules, which its lucent.json names as its modules are named", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-launch-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
    fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify({ launch: ["tasks"] }));
    fs.writeFileSync(path.join(dir, "tasks.lucent.ts"), tasks);
    const r = compile([path.join(dir, "tasks.lucent.ts")], { platforms: ["host"], root: dir });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.files.get("lucent_entries.cpp")).toContain("// Launch modules: tasks.");

    fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify({ launch: ["task"] }));
    const missing = compile([path.join(dir, "tasks.lucent.ts")], {
      platforms: ["host"],
      root: dir,
    });
    expect(missing.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `LUCENT3015 the app's lucent.json's launch lists "task", but the app has no module task`,
    ]);
  });

  it("fail the build for a launch module the package doesn't have", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-launch-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "lucent-tasks", version: "1.0.0", lucent: {} }),
    );
    fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify({ launch: ["task"] }));
    fs.writeFileSync(path.join(dir, "tasks.lucent.ts"), tasks);
    const r = compile([path.join(dir, "tasks.lucent.ts")], { platforms: ["host"] });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `LUCENT3015 lucent.json's launch lists "task", but lucent-tasks has no module lucent-tasks/task`,
    ]);
  });
});

/** Platform objects (decision 0116): a jobject in a lucent_value, on the desktop JNI host. */
const objects = `import { Build } from "lucent:android/android.os";

export function version(): number {
  return 1;
}

export function label(b: Build | null): string {
  return b === null ? "none" : "a Build";
}

export function echo(b: Build): Build {
  return b;
}

export function count(bs: Build[]): number {
  return bs.length;
}
`;

const objectsMain = `#include <cstdio>
#include <string>

#include "jni_host.h"
#include "lucent_entries.h"
#include <lucent/platform/android.h>

static std::string text(lucent_string s) { return std::string(s.data, s.length); }
static lucent_value object(void* o) {
  lucent_value v{LUCENT_PLATFORM_OBJECT, {}};
  v.as.object = o;
  return v;
}

int main(int, char** argv) {
  lucentStartJvm(argv[1]);
  JNIEnv* env = lucent::jni::env();
  jclass build = env->FindClass("android/os/Build");
  jobject made = env->NewObject(build, env->GetMethodID(build, "<init>", "()V"));

  lucent_error error{};
  lucent_string label{};
  lucent_m_label(object(made), &error, &label);
  std::printf("label %s", text(label).c_str());
  lucent_m_label(lucent_value{LUCENT_NULL, {}}, &error, &label);
  std::printf(" %s\\n", text(label).c_str());

  lucent_value back{};
  lucent_m_echo(object(made), &error, &back);
  std::printf("echo %d\\n", back.kind == LUCENT_PLATFORM_OBJECT && env->IsSameObject(static_cast<jobject>(back.as.object), made));

  const lucent_value both[] = {object(made), object(made)};
  lucent_value list{LUCENT_ARRAY, {}};
  list.as.array = lucent_array{both, 2};
  double n = 0;
  lucent_m_count(list, &error, &n);
  std::printf("count %g\\n", n);
  return 0;
}
`;

const android = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-android-")), {
  "android/os/Build.java": `package android.os;
public class Build {
  public static final String MODEL = "stand-in";
}
`,
});

describe.skipIf(!android || !jdk)("native entry points, on Android", () => {
  it("pass platform objects as jobjects in lucent_values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-entries-android-"));
    // Its declaration file leaves out what takes or gives a platform object (0117).
    fs.writeFileSync(path.join(dir, "m.lucent.ts"), "export declare function version(): number;\n");
    fs.writeFileSync(path.join(dir, "m.android.lucent.ts"), objects);
    const r = compile([path.join(dir, "m.lucent.ts"), path.join(dir, "m.android.lucent.ts")], {
      platforms: ["android"],
      sdk: { android: { jars: android!.bind } },
    });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.files.get("android/lucent_entries.h")).toContain(
      "bool lucent_m_echo(lucent_value arg0, lucent_error* error, lucent_value* result);",
    );

    expect(jvmRun(r, dir, android!.run, undefined, objectsMain)).toEqual({
      status: 0,
      stdout: "label a Build none\necho 1\ncount 2\n",
      stderr: "",
    });
  }, 300_000);
});
