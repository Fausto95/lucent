/**
 * A class a platform module declares (`export declare class` in its
 * declaration file), which each platform file implements (T106): shared
 * code uses the declared class and compiles to the platform's, a host
 * build makes a class whose every member throws, and a platform's class
 * that doesn't match the declaration is LUCENT3005. Android code compiles
 * against stand-ins and runs on the desktop JNI host.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

const standIns = {
  "android/os/Build.java": `package android.os;
public class Build {
  public static final String MODEL = "stand-in";
}
`,
};

const android = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pclass-")), standIns);

function build(sources: Record<string, string>, platforms: ("ios" | "android" | "host")[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pclass-"));
  const files = Object.entries(sources).map(([name, text]) => {
    fs.writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  });
  const r = compile(files, { platforms, sdk: { android: { jars: android!.bind } } });
  return { r, dir, shown: r.diagnostics.map((d) => `${d.code} ${d.line}: ${d.message}`) };
}

const DECLARATION = `export declare class Counter {
  constructor(start: number);
  readonly label: string;
  increment(by: number): number;
  get total(): number;
  static describe(): string;
  settle(): Promise<string>;
}
`;

const ANDROID = `import { Build } from "lucent:android/android.os";

export class Counter {
  readonly label: string = Build.MODEL ?? "";
  private count: number;

  constructor(start: number) {
    this.count = start;
  }

  increment(by: number): number {
    this.count += by;
    return this.count;
  }

  get total(): number {
    return this.count;
  }

  static describe(): string {
    return "counts on Android";
  }

  async settle(): Promise<string> {
    return \`settled at \${this.count}\`;
  }
}
`;

const IOS = `export class Counter {
  readonly label: string = "iOS";
  private count: number;

  constructor(start: number) {
    this.count = start;
  }

  increment(by: number): number {
    this.count += by;
    return this.count;
  }

  get total(): number {
    return this.count;
  }

  static describe(): string {
    return "counts on iOS";
  }

  async settle(): Promise<string> {
    return \`settled at \${this.count}\`;
  }
}
`;

const USER = `import { Counter } from "./counter.lucent";

export async function run(): Promise<string> {
  const c = new Counter(1);
  c.increment(2);
  return \`\${c.total} \${c.label} \${Counter.describe()} \${await c.settle()} \${c instanceof Counter}\`;
}

export function make(start: number): Counter {
  return new Counter(start);
}
`;

const MODULE = {
  "counter.lucent.ts": DECLARATION,
  "counter.android.lucent.ts": ANDROID,
  "counter.ios.lucent.ts": IOS,
  "user.lucent.ts": USER,
};

describe.skipIf(!android)("a class a platform module declares", () => {
  it("is the platform file's class in code that uses it", () => {
    const { r, shown } = build(MODULE, ["android", "ios", "host"]);
    expect(shown).toEqual([]);
    for (const target of ["android", "ios"]) {
      const user = r.files.get(`${target}/m_user.cpp`)!;
      expect(user).toContain("lucent_app::C_Counter::create(1.0)");
      expect(user).toContain("lucent_app::C_Counter::describe()");
    }
    expect(r.proxies.get("counter")).toMatch(/Counter = lucentClass\(m\.Counter\)/);
  });

  it("throws from every member on the host, where no platform file is", () => {
    const { r, shown } = build(MODULE, ["host"]);
    expect(shown).toEqual([]);
    const host = r.files.get("host/m_counter.cpp")!;
    for (const member of ["Counter", "Counter.increment", "Counter.total", "Counter.describe"])
      expect(host).toContain(`counter.${member} is not available on this platform`);
    // A promise rejects, as a declared function's does.
    expect(host).toMatch(/Promise<lucent::String>::rejected\([^]*counter\.Counter\.settle/);
  });

  it.skipIf(!jdk)(
    "runs the platform's class",
    () => {
      // The harness runs module m's run().
      const androidOnly = {
        "counter.lucent.ts": DECLARATION,
        "counter.android.lucent.ts": ANDROID,
        "m.lucent.ts": USER,
      };
      const { r, dir, shown } = build(androidOnly, ["android"]);
      expect(shown).toEqual([]);
      expect(jvmRun(r, dir, android!.run)).toEqual({
        status: 0,
        stdout: "3 stand-in counts on Android settled at 3 true\n",
        stderr: "",
      });
    },
    300_000,
  );
});

describe.skipIf(!android)("a platform class that doesn't match its declaration", () => {
  const withAndroid = (code: string) => ({
    "counter.lucent.ts": DECLARATION,
    "counter.android.lucent.ts": code,
  });

  it.each([
    [
      "has a public member the declaration doesn't name",
      ANDROID.replace("  static describe", "  reset(): void {}\n\n  static describe"),
      "the member reset",
    ],
    [
      "has a static member the declaration doesn't name",
      ANDROID.replace(
        "  static describe",
        "  static make(): Counter {\n    return new Counter(0);\n  }\n\n  static describe",
      ),
      "the static member make",
    ],
    [
      "writes a declared accessor as a method",
      ANDROID.replace("get total(): number", "total(): number"),
      "is an accessor in counter.lucent.ts and a method",
    ],
    [
      "takes another type",
      ANDROID.replace("increment(by: number)", "increment(by: string)").replace(
        "this.count += by",
        "this.count += by.length",
      ),
      "does not match the class",
    ],
    ["is a function", "export function Counter(): void {}\n", "is not a class"],
  ])("%s", (_, code, message) => {
    const { shown } = build(withAndroid(code), ["android"]);
    expect(shown.some((s) => s.startsWith("LUCENT3005") && s.includes(message))).toBe(true);
  });

  it("keeps private members and helpers to itself", () => {
    const code = ANDROID.replace(
      "  private count: number;",
      "  private count: number;\n  #seen = 0;\n  protected step = 1;",
    );
    const { shown } = build(withAndroid(code), ["android"]);
    expect(shown).toEqual([]);
  });
});
