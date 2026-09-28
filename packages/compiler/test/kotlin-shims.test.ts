import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { androidJars, sdkAvailable } from "@lucent-lang/bindgen";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { compileKotlin, kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { compile, type CompileResult, type SdkOptions } from "../src/index.ts";
import { consumerRules } from "../src/native-build-files.ts";
import { android, ndkClang, ndkErrors } from "./android-harness.ts";

/*
 * Kotlin members JNI cannot call as Kotlin declares them (suspend
 * functions, defaults left out, value classes the JVM unboxes), called
 * through Kotlin shims generated for the program: examples/lucent-orbit's
 * library, compiled here, stands for an app's dependency. The shims are
 * compiled with kotlinc (warnings as errors), run on the JVM as the JNI
 * glue calls them, and shrunk with R8 under the library's keep rules.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const orbitSources = path.resolve(here, "../../../examples/lucent-orbit/kotlin");

const tc = kotlinToolchain();

const coroutines = tc && path.join(tc.lib, "kotlinx-coroutines-core-jvm.jar");

const toolchain = !!tc && !!coroutines && fs.existsSync(coroutines) && sdkAvailable("android");

const java = (tool: string) =>
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", tool) : tool;

/** R8, from the Android SDK's newest build tools. */
function r8(): string | undefined {
  const root = path.join(
    process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"),
    "build-tools",
  );
  const newest = fs.existsSync(root) ? fs.readdirSync(root).sort().pop() : undefined;
  const jar = newest && path.join(root, newest, "lib/d8.jar");

  return jar && fs.existsSync(jar) ? jar : undefined;
}

const shims = "dev/lucent/shims";

const searchShims = `${shims}/LucentShims_dev_orbit_search.kt`;

const shapesShims = `${shims}/LucentShims_dev_orbit_shapes.kt`;

const idsShims = `${shims}/LucentShims_dev_orbit_ids.kt`;

const searching = `import { Searcher } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const searcher = new Searcher();
  const found = await searcher.search("or");
  const controller = new AbortController();
  const pending = searcher.search("o", 5, 5000n, controller.signal);
  controller.abort();
  let cancelled = "no";
  try {
    await pending;
  } catch (e) {
    cancelled = "yes";
  }
  await searcher.forget();
  return \`\${found.length} \${await searcher.count()} \${await searcher.stubborn(10n)} \${cancelled}\`;
}
`;

const defaults = `import { Searcher } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const named = new Searcher("named");
  const searcher = new Searcher();
  return \`\${named.name} \${searcher.describe()} \${searcher.describe("find")} \${searcher.describe("find", null)}\`;
}
`;

const shapes = `import { Circle, Meters, Rect, ShapesKt } from "lucent:android/dev.orbit.shapes";
export async function run(): Promise<string> {
  const meters = new Meters(2);
  const scaled = ShapesKt.scaled(new Circle(1));
  const perimeter = ShapesKt.perimeter(new Rect(1, 2));
  ShapesKt.unit = "ft";
  const described = scaled instanceof Circle ? \`circle \${scaled.radius}\` : ShapesKt.describe(scaled);
  return \`\${ShapesKt.feet(meters)} \${perimeter.value} \${ShapesKt.circleOf(meters).radius} \${ShapesKt.unit} \${described}\`;
}
`;

const setters = `import { Searcher } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const searcher = new Searcher();
  searcher.pageSize = 5;
  searcher.lastQuery = null;
  return \`\${searcher.pageSize}\`;
}
`;

/** Kotlin Longs beyond 2^53: in value classes, defaults, results and suspend functions. */
const longs = `import { Id, Ids } from "lucent:android/dev.orbit.ids";
export async function run(): Promise<string> {
  const ids = new Ids();
  const next = ids.next(new Id(9007199254740993n));
  const far = ids.next(next, 2n ** 62n);
  const offset = await ids.offset(2n);
  const first = await ids.first();
  const range = ids.range(2);
  return \`\${next.value} \${far.value} \${ids.plus()} \${offset} \${first.value} \${range.join(",")} \${ids.sum(range)}\`;
}
`;

/** Kotlin collections: read-only lists copied both ways, a mutable list as itself. */
const collections = `import { Shelf } from "lucent:android/dev.orbit.shelf";
export async function run(): Promise<string> {
  const shelf = new Shelf(["orbit", "ocean", "origin"]);
  const titles = shelf.titles;
  titles.push("mine");
  const live = shelf.live;
  live.add("planet");
  const rows = shelf.rows(2);
  shelf.replace(["a", "b"]);
  return \`\${titles.join(",")} \${live.size()} \${shelf.lengths().join(",")} \${shelf.withGaps().join(",")} \${rows.map((r) => r.join("+")).join("/")} \${shelf.lengthArray().join(",")} \${shelf.total([1.5, 2])} \${shelf.join(["x", null, "y"])}\`;
}
`;

/** Kotlin flows collected with Lucent functions, and suspend functions Lucent functions implement. */
const flowing = `import { Ticker } from "lucent:android/dev.orbit.ticker";
export async function run(): Promise<string> {
  const ticker = new Ticker();
  const seen: number[] = [];
  await ticker.count(3, 0n).collect((n) => {
    seen.push(n);
  });
  const words: string[] = [];
  let failed = "";
  try {
    await ticker.failing("one").collect((s) => {
      words.push(s);
    });
  } catch (e) {
    failed = (e as Error).message;
  }
  const controller = new AbortController();
  let ticks = 0;
  let stopped = "";
  try {
    await ticker.forever(5n).collect(() => {
      if (++ticks === 3) controller.abort();
    }, controller.signal);
  } catch (e) {
    stopped = (e as Error).name;
  }
  const n = await ticker.each(["a", "b"], (s) => {
    words.push(s);
  });
  const up = await ticker.transformed("x", (s) => s.toUpperCase());
  return \`\${seen.join(",")} \${words.join(",")} \${failed} \${stopped} \${ticks} \${n} \${up}\`;
}
`;

const flowShims = `${shims}/LucentShims_kotlinx_coroutines_flow.kt`;

const tickerShims = `${shims}/LucentShims_dev_orbit_ticker.kt`;

/** A flow as a lucent:core subscription: collect() runs it, the subscription's cleanup cancels it. */
const subscribing = `import { Ticker } from "lucent:android/dev.orbit.ticker";
import type { Flow } from "lucent:android/kotlinx.coroutines.flow";
import { subscribe } from "lucent:core";
async function collect(
  flow: Flow<number>,
  next: (n: number) => void,
  end: () => void,
  fail: (error: Error) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    await flow.collect(next, signal);
    end();
  } catch (e) {
    fail(e as Error);
  }
}
function subscribed(flow: Flow<number>, onValue: (n: number) => void, signal?: AbortSignal): Promise<void> {
  return subscribe<number>(
    (next, end, fail) => {
      const collecting = new AbortController();
      void collect(flow, next, end, fail, collecting.signal);
      return () => collecting.abort();
    },
    onValue,
    signal,
  );
}
export async function run(): Promise<string> {
  const ticker = new Ticker();
  const seen: number[] = [];
  await subscribed(ticker.count(3), (n) => {
    seen.push(n);
  });
  const controller = new AbortController();
  let outcome = "completed";
  try {
    await subscribed(ticker.forever(5n), () => controller.abort(), controller.signal);
  } catch (e) {
    outcome = (e as Error).name;
  }
  return \`\${seen.join(",")} \${outcome}\`;
}
`;

/** What the JVM harness calls: each suspend and default pattern once. */
const harnessed = `import { Searcher } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const searcher = new Searcher();
  const signal = new AbortController().signal;
  const found = await searcher.search("or");
  const all = await searcher.search("o", 5, 5000n, signal);
  const late = await searcher.stubborn(200n);
  const n = await searcher.count();
  return \`\${found.length} \${all.length} \${late} \${n} \${searcher.describe()} \${searcher.describe("find")} \${searcher.describe("find", null)}\`;
}
`;

describe.skipIf(!toolchain)("Kotlin shims", () => {
  let dir: string;
  let orbit: string;
  let sdk: SdkOptions;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-shims-"));
    const sources = fs
      .readdirSync(orbitSources, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".kt"))
      .map((f) => path.join(orbitSources, f));

    orbit = await compileKotlin(tc!, sources, path.join(dir, "orbit.jar"), {
      classpath: coroutines!,
    });
    const classpath = classpathFile(path.join(dir, "android-classpath.json"), [
      path.join(tc!.lib, "kotlin-stdlib.jar"),
      coroutines!,
      orbit,
    ]);
    sdk = { android: { classpath } };
  }, 300_000);

  /** The generated Kotlin files, compiled into a jar with kotlinc, warnings as errors. */
  const compiled = (r: CompileResult, name: string) => {
    const out = path.join(dir, name);
    const files = [...(r.kotlin ?? [])].map(([file, source]) => {
      const full = path.join(out, "src", file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, source);
      return full;
    });
    const cc = spawnSync(
      tc!.kotlinc,
      [
        "-jvm-target",
        "11",
        "-Werror",
        "-cp",
        [orbit, coroutines].join(path.delimiter),
        ...files,
        "-d",
        path.join(out, "shims.jar"),
      ],
      { encoding: "utf8", maxBuffer: 1 << 26 },
    );

    return { status: cc.status, stderr: cc.stderr, jar: path.join(out, "shims.jar") };
  };

  it("calls a suspend function through a generated Kotlin shim, as a promise it can cancel", () => {
    const { r, cpp } = android(searching, sdk);
    const kotlin = r.kotlin?.get(searchShims) ?? "";
    const dts = r.types?.get("android/dev.orbit.search.d.ts") ?? "";

    expect(r.diagnostics).toEqual([]);
    expect([...(r.kotlin?.keys() ?? [])]).toEqual([searchShims]);
    expect(kotlin).toContain("object LucentShims_dev_orbit_search {");
    expect(kotlin).toContain("fun Searcher_search_");
    expect(kotlin).toContain("done: java.util.function.BiConsumer<Any?, Throwable?>");
    expect(kotlin).toContain("CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)");
    expect(cpp).toContain("lucent::jni::launch<");
    expect(cpp).toContain('"dev/lucent/shims/LucentShims_dev_orbit_search"');
    expect(cpp).toMatch(/Ljava\/util\/function\/BiConsumer;\)Ljava\/lang\/AutoCloseable;"/);

    // The Kotlin source's signature, with no trace of the JVM's continuation.
    expect(dts).toContain(
      "search(prefix: string, limit?: number, latency?: bigint, signal?: AbortSignal): Promise<",
    );
    for (const text of [kotlin, cpp, dts]) expect(text).not.toContain("Continuation");
  });

  it("leaves out Kotlin defaults through shims, and passes null as null", () => {
    const { r, cpp } = android(defaults, sdk);
    const kotlin = r.kotlin?.get(searchShims) ?? "";

    expect(r.diagnostics).toEqual([]);
    // Every argument given: the JVM method, over JNI.
    expect(cpp).toContain('"describe", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"');
    // Left out: shims that leave them out.
    expect(kotlin).toContain(".describe()");
    expect(kotlin).toMatch(/\.describe\(prefix = cast\(a0\)\)/);
    expect(kotlin).toMatch(/dev\.orbit\.search\.Searcher\(name = cast\(a0\)\)/);
  });

  it("refuses an argument that may be undefined where Kotlin has a default", () => {
    const { r } = android(
      `import { Searcher } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const prefix: string | undefined = Math.random() > 2 ? "x" : undefined;
  return new Searcher().describe(prefix);
}
`,
      sdk,
    );

    expect(r.diagnostics).toMatchObject([
      {
        code: "LUCENT1007",
        message: expect.stringContaining(
          "Searcher.describe(): prefix may be undefined, and Lucent leaves out a Kotlin default only where the call does: pass a value, or leave the argument out",
        ),
      },
    ]);
  });

  it("calls value classes, sealed cases, extensions and top-level declarations", () => {
    const { r, cpp } = android(shapes, sdk);
    const kotlin = r.kotlin?.get(shapesShims) ?? "";

    expect(r.diagnostics).toEqual([]);
    // Value classes cross boxed: a shim constructs, unboxes and boxes them.
    expect(kotlin).toContain("dev.orbit.shapes.Meters(value = a0)");
    expect(kotlin).toContain("import dev.orbit.shapes.feet");
    expect(kotlin).toContain("cast<dev.orbit.shapes.Meters>(receiver).feet()");
    expect(kotlin).toContain("dev.orbit.shapes.perimeter(shape = cast(a0))");
    expect(kotlin).toContain("dev.orbit.shapes.circleOf(radius = cast(a0))");
    // A default left out of an extension, called on its receiver.
    expect(kotlin).toContain("import dev.orbit.shapes.scaled");
    expect(kotlin).toContain("cast<dev.orbit.shapes.Shape>(receiver).scaled()");
    // A sealed case, matched with instanceof; a top-level property's setter.
    expect(cpp).toContain("IsInstanceOf");
    expect(cpp).toContain('"setUnit", "(Ljava/lang/String;)V"');
  });

  it("passes Kotlin Longs as bigints through shims, and completes with them", () => {
    const { r, cpp } = android(longs, sdk);
    const kotlin = r.kotlin?.get(idsShims) ?? "";
    const dts = r.types?.get("android/dev.orbit.ids.d.ts") ?? "";

    expect(r.diagnostics).toEqual([]);

    // Every Long is a bigint: value classes over one, defaults, results, suspend functions.
    for (const declared of [
      "constructor(value: bigint);",
      "readonly value: bigint;",
      "next(id: Id, step?: bigint): Id;",
      "plus(step?: bigint): bigint;",
      "offset(by: bigint, signal?: AbortSignal): Promise<bigint>;",
      "first(signal?: AbortSignal): Promise<Id>;",
      "range(count: number): bigint[];",
      "sum(values: bigint[]): bigint;",
    ])
      expect(dts).toContain(declared);

    // Shims take and give Longs as themselves; the glue converts them exactly.
    expect(kotlin).toMatch(
      /fun Id_new_\w+\(a0: Long\): Any\? \{\n\s+return dev\.orbit\.ids\.Id\(value = a0\)/,
    );
    expect(kotlin).toMatch(/fun Ids_plus_\w+\(receiver: Any\): Long \{/);
    expect(kotlin).toMatch(/fun Ids_offset_\w+\(receiver: Any, a0: Long, done: /);
    expect(cpp).toContain('lucent::toNativeInteger<jlong>(a0_, "by of Ids.offset")');
    expect(cpp).toContain("lucent::BigInt{lucent::jni::unboxLong(env, v_)}");
    // A read-only list of Longs: each element boxed and unboxed exactly.
    expect(cpp).toContain("lucent::BigInt{lucent::jni::unboxLong(env, e_)}");
    expect(cpp).toContain(
      'lucent::jni::boxLong(env, lucent::toNativeInteger<jlong>(e_, "values of Ids.sum"))',
    );
  });

  it("copies Kotlin's read-only lists both ways, and keeps a mutable list as the object it is", () => {
    const { r, cpp } = android(collections, sdk);
    const dts = r.types?.get("android/dev.orbit.shelf.d.ts") ?? "";

    expect(r.diagnostics).toEqual([]);
    // Read-only lists are arrays; the mutable list is the Java object.
    for (const declared of [
      "constructor(titles?: string[]);",
      "readonly titles: string[];",
      "readonly live: List<string>;",
      "lengths(): number[];",
      "withGaps(): (string | null)[];",
      "rows(width: number): string[][];",
      "lengthArray(): number[];",
      "replace(titles: string[]): void;",
      "total(values: number[]): number;",
      "join(parts: (string | null)[], separator?: string): string;",
    ])
      expect(dts).toContain(declared);

    // Copied through java.util.List: its elements read and written one by one.
    expect(cpp).toContain("lucent::jni::fromList<");
    expect(cpp).toContain("lucent::jni::toList(");
    expect(cpp).toContain('"replace", "(Ljava/util/List;)V"');
    expect(cpp).toContain("lucent::jni::unboxNumber(");
    expect(cpp).toContain("lucent::jni::boxDouble(");
  });

  it("collects a Kotlin flow with a Lucent function, through a generic member's shim", () => {
    const { r, cpp } = android(flowing, sdk);
    const flow = r.kotlin?.get(flowShims) ?? "";
    const ticker = r.kotlin?.get(tickerShims) ?? "";

    expect(r.diagnostics).toEqual([]);
    // A generic interface's member: its type parameters as Any?.
    expect(flow).toContain(
      "cast<kotlinx.coroutines.flow.Flow<Any?>>(receiver).collect(collector = kotlinx.coroutines.flow.FlowCollector { x0 -> cast<(Any?) -> Any?>(a0)(x0) })",
    );
    // Suspend function parameters: lambdas calling the Lucent function.
    expect(ticker).toContain("step = { x0 -> cast<(Any?) -> Any?>(a1)(x0) }");
    expect(ticker).toContain("transform = { x0 -> cast(cast<(Any?) -> Any?>(a1)(x0)) }");
    // The Lucent function: a Kotlin function object, run while Kotlin waits;
    // what it throws ends the Kotlin call with that error.
    expect(cpp).toContain('"kotlin/jvm/functions/Function1"');
    expect(cpp).toContain('"invoke(Ljava/lang/Object;)"');
    expect(cpp).toContain("lucent::jni::callSuspending(");
  });

  it("composes a flow's collection with subscribe, whose cleanup cancels it", () => {
    const { r, cpp } = android(subscribing, sdk);
    const flow = r.kotlin?.get(flowShims) ?? "";

    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::subscribe(");
    expect(cpp).toContain("lucent::jni::launch<");
    expect(flow).toContain(").collect(collector = kotlinx.coroutines.flow.FlowCollector {");
  });

  it("refuses an async Lucent function where Kotlin takes a suspend function", () => {
    const { r } = android(
      `import { Ticker } from "lucent:android/dev.orbit.ticker";
export async function run(): Promise<string> {
  await new Ticker().count(2).collect(async (n) => {
    await Promise.resolve(n);
  });
  return "";
}
`,
      sdk,
    );

    expect(r.diagnostics).toMatchObject([
      {
        code: "LUCENT1007",
        message: expect.stringContaining(
          "Flow.collect(): an async function cannot run as a Kotlin suspend function yet: Kotlin would not wait for its promise",
        ),
      },
    ]);
  });

  it("leaves out a Kotlin default before a parameter without one where the call passes undefined", () => {
    const { r } = android(
      `import { Shelf } from "lucent:android/dev.orbit.shelf";
export async function run(): Promise<string> {
  return new Shelf().slice(undefined, 1).join(",");
}
`,
      sdk,
    );
    const dts = r.types?.get("android/dev.orbit.shelf.d.ts") ?? "";
    const kotlin = r.kotlin?.get(`${shims}/LucentShims_dev_orbit_shelf.kt`) ?? "";

    expect(r.diagnostics).toEqual([]);
    expect(dts).toContain("slice(from: number | undefined, count: number): string[];");
    expect(kotlin).toContain(".slice(count = a1)");
  });

  it("calls an interface's default method asserted present, as implementers may leave it out", () => {
    const { r, cpp } = android(
      `import { Ticker } from "lucent:android/dev.orbit.ticker";
export async function run(): Promise<string> {
  return new Ticker().source().describe!();
}
`,
      sdk,
    );

    expect(r.types?.get("android/dev.orbit.ticker.d.ts")).toContain("  describe?(): string;");
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"describe", "()Ljava/lang/String;"');
  });

  it("writes Kotlin properties through their setters", () => {
    const { r, cpp } = android(setters, sdk);

    expect(r.diagnostics).toEqual([]);
    expect(r.kotlin?.size ?? 0).toBe(0);
    expect(cpp).toContain('"setPageSize", "(I)V"');
    expect(cpp).toContain('"setLastQuery", "(Ljava/lang/String;)V"');
  });

  it("generates Kotlin that kotlinc compiles, warnings as errors", () => {
    for (const [src, name] of [
      [searching, "searching"],
      [defaults, "defaults"],
      [shapes, "shapes"],
      [longs, "longs"],
      [flowing, "flowing"],
    ] as const) {
      const { r } = android(src, sdk);
      const { status, stderr } = compiled(r, name);

      expect(stderr).toBe("");
      expect(status).toBe(0);
    }
  }, 300_000);

  it("settles, fails, cancels early, drops late results and leaves out defaults on the JVM", () => {
    const { r } = android(harnessed, sdk);
    const { jar, status, stderr } = compiled(r, "harnessed");
    expect(stderr).toBe("");
    expect(status).toBe(0);

    const classes = path.join(dir, "harness");
    const classpath = [classes, jar, orbit, coroutines!, path.join(tc!.lib, "kotlin-stdlib.jar")];
    const javac = spawnSync(
      java("javac"),
      [
        "--release",
        "11",
        "-cp",
        classpath.join(path.delimiter),
        "-d",
        classes,
        path.join(here, "fixtures/kotlin-shims/ShimHarness.java"),
      ],
      { encoding: "utf8" },
    );
    expect(javac.stderr).toBe("");

    const run = spawnSync(
      java("java"),
      [
        "-cp",
        classpath.join(path.delimiter),
        "ShimHarness",
        "dev.lucent.shims.LucentShims_dev_orbit_search",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

    expect(run.stderr).toBe("");
    expect(run.stdout.trim().split("\n")).toEqual([
      "result orbit orange",
      "thrown java.lang.IllegalArgumentException: bad query: !",
      "early true true",
      "late late",
      "count java.lang.Integer 5",
      "defaults search:orbit find:orbit find orbit",
    ]);
  }, 300_000);

  it("collects, fails, cancels and runs suspend function arguments on the JVM", () => {
    const { r } = android(flowing, sdk);
    const { jar, status, stderr } = compiled(r, "flowing-harness");
    expect(stderr).toBe("");
    expect(status).toBe(0);

    const classes = path.join(dir, "flow-harness");
    const classpath = [classes, jar, orbit, coroutines!, path.join(tc!.lib, "kotlin-stdlib.jar")];
    const javac = spawnSync(
      java("javac"),
      [
        "--release",
        "11",
        "-cp",
        classpath.join(path.delimiter),
        "-d",
        classes,
        path.join(here, "fixtures/kotlin-shims/ShimHarness.java"),
        path.join(here, "fixtures/kotlin-shims/FlowHarness.java"),
      ],
      { encoding: "utf8" },
    );
    expect(javac.stderr).toBe("");

    const run = spawnSync(java("java"), ["-cp", classpath.join(path.delimiter), "FlowHarness"], {
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(run.stderr).toBe("");
    expect(run.stdout.trim().split("\n")).toEqual([
      "values 1,2,3 completed",
      "failed one java.lang.IllegalStateException: broken after one",
      "cancelled true 3 stopped",
      "thrown the collector's own exception, after 2",
      "each 2 a,b",
      "transformed X on another thread",
    ]);
  }, 300_000);

  it.skipIf(!r8())(
    "keeps the shims and what the glue calls through R8",
    () => {
      const { r } = android(harnessed, sdk);
      const { jar } = compiled(r, "shrunk");
      const rules = path.join(dir, "rules.pro");
      fs.writeFileSync(
        rules,
        `${consumerRules(r.javaKeep ?? [])}\n# The libraries' own references outside android.jar.\n-dontwarn **\n`,
      );

      const out = path.join(dir, "shrunk.jar");
      const shrink = spawnSync(
        java("java"),
        [
          "-cp",
          r8()!,
          "com.android.tools.r8.R8",
          "--classfile",
          "--release",
          "--lib",
          androidJars()![0]!,
          "--pg-conf",
          rules,
          "--output",
          out,
          jar,
          orbit,
          coroutines!,
          path.join(tc!.lib, "kotlin-stdlib.jar"),
        ],
        { encoding: "utf8", maxBuffer: 1 << 26 },
      );
      expect(shrink.status, shrink.stderr).toBe(0);

      const javap = spawnSync(
        java("javap"),
        ["-s", "-cp", out, "dev.lucent.shims.LucentShims_dev_orbit_search"],
        { encoding: "utf8" },
      );
      const kept = javap.stdout;
      const names = [...(r.kotlin!.get(searchShims) ?? "").matchAll(/fun (Searcher_\w+)\(/g)].map(
        (m) => m[1]!,
      );

      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(kept).toContain(` ${name}(`);
    },
    300_000,
  );

  // The jar is byte-identical only from the compiler that wrote it.
  it.skipIf(!tc?.version.startsWith("2.4."))(
    "ships, in examples/lucent-orbit, the jar its Kotlin sources compile to",
    () => {
      const out = path.join(dir, "rebuilt.jar");
      // The test's timeout cannot interrupt a synchronous spawn: the spawn's own ends a hung build.
      const build = spawnSync(process.execPath, [path.join(orbitSources, "../build-jar.ts"), out], {
        encoding: "utf8",
        timeout: 240_000,
        killSignal: "SIGKILL",
      });

      expect(build.error, "build-jar.ts did not exit within 240 s").toBeUndefined();
      expect(build.status, build.stderr).toBe(0);
      expect(
        fs
          .readFileSync(out)
          .equals(fs.readFileSync(path.join(orbitSources, "../android/orbit.jar"))),
      ).toBe(true);
    },
    300_000,
  );

  it("compiles examples/lucent-orbit's fixture modules for Android, with its library", () => {
    const r = compile(
      ["orbit", "collections", "flows"].map((m) =>
        path.join(orbitSources, `../src/${m}.lucent.ts`),
      ),
      { platforms: ["android"], sdk },
    );

    expect(r.diagnostics).toEqual([]);
    expect([...(r.kotlin?.keys() ?? [])].sort()).toEqual(
      [
        idsShims,
        searchShims,
        shapesShims,
        `${shims}/LucentShims_dev_orbit_shelf.kt`,
        tickerShims,
        flowShims,
      ].sort(),
    );
  });

  it.skipIf(!ndkClang())(
    "generates JNI C++ for Kotlin shims that compiles with the NDK",
    () => {
      for (const src of [
        searching,
        defaults,
        shapes,
        setters,
        longs,
        collections,
        flowing,
        subscribing,
      ]) {
        const { r, dir: out } = android(src, sdk);

        expect(r.diagnostics).toEqual([]);
        expect(ndkErrors(ndkClang()!, r.files, out)).toBe("");
      }
    },
    300_000,
  );
});
