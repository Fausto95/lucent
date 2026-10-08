import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * Platform code beyond one inline test: a `const` holding a platform test,
 * a platform file without its twin, and shared constants and enums in a
 * split module's declaration file. Android code compiles against
 * stand-ins and runs on the desktop JNI host; iOS code is untyped without
 * Xcode.
 */

const standIns = {
  "android/os/Build.java": `package android.os;
public class Build {
  public static final String MODEL = "stand-in";
}
`,
};

const android = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pfiles-")), standIns);

/** `sources` compiled for `platforms` against the stand-ins: the result, its directory and its diagnostics. */
function build(sources: Record<string, string>, platforms: ("ios" | "android" | "host")[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pfiles-"));
  const files = Object.entries(sources).map(([name, text]) => {
    fs.writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  });
  const r = compile(files, { platforms, sdk: { android: { jars: android!.bind } } });
  return { r, dir, shown: r.diagnostics.map((d) => `${d.code} ${d.line}: ${d.message}`) };
}

const aliased = {
  "m.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";

const isIos = PLATFORM === "ios";
const isAndroid = PLATFORM !== "ios";

function model(): string {
  if (isIos) return UIDevice.current.model;
  return Build.MODEL ?? "";
}

export async function run(): Promise<string> {
  const local = PLATFORM === "android";
  const name = isAndroid ? Build.MODEL : "";
  if (local) return \`\${model()} \${name} \${isIos}\`;
  else return UIDevice.current.name;
}
`,
};

describe.skipIf(!android)("a const holding a platform test", () => {
  it("narrows like the test it holds", () => {
    const { r, shown } = build(aliased, ["android", "host"]);
    expect(shown).toEqual([]);
    expect(r.files.get("android/m_m.cpp")).not.toContain("UIDevice");
    // The host reads PLATFORM where the const is used, not when the module starts.
    const init = r.files.get("host/m_m.cpp")!.split("void m_m::init()")[1]!;
    expect(init).not.toContain("runs only on iOS and Android");
  });

  it.skipIf(!jdk)(
    "runs the branch of the platform it tests",
    () => {
      const { r, dir, shown } = build(aliased, ["android"]);
      expect(shown).toEqual([]);
      expect(jvmRun(r, dir, android!.run)).toEqual({
        status: 0,
        stdout: "stand-in stand-in false\n",
        stderr: "",
      });
    },
    300_000,
  );
});

/** A split module: a declaration file with shared values, and an Android file only. */
const androidOnly = {
  "m.lucent.ts": `export const LIMIT = 3;
export enum Mode {
  Plain = "plain",
  Loud = "loud",
}
export declare function run(): Promise<string>;
export declare function model(mode: Mode): string;
`,
  "m.android.lucent.ts": `import { Build } from "lucent:android/android.os";
import { LIMIT, Mode } from "./m.lucent";

export function model(mode: Mode): string {
  const name = Build.MODEL ?? "";
  return mode === Mode.Loud ? name.toUpperCase() : name;
}

export async function run(): Promise<string> {
  return \`\${model(Mode.Loud)} \${LIMIT} \${Mode.Plain}\`;
}
`,
  "user.lucent.ts": `import { LIMIT, Mode, model } from "./m.lucent";
export function twice(): string {
  return \`\${model(Mode.Plain)} \${LIMIT * 2}\`;
}
`,
};

describe.skipIf(!android)("a platform file without its twin", () => {
  it("leaves the other platform's exports throwing or rejecting", () => {
    const { r, shown } = build(androidOnly, ["android", "ios", "host"]);
    expect(shown).toEqual([]);
    expect(r.files.get("android/m_m.cpp")).toContain(`LUCENT_STR("stand-in")`);
    const ios = r.files.get("ios/m_m.mm") ?? r.files.get("ios/m_m.cpp")!;
    expect(ios).toContain("m.run is not available on iOS");
    expect(ios).toContain("m.model is not available on iOS");
  });

  it("shares the declaration file's constants and enums", () => {
    const { r, shown } = build(androidOnly, ["android", "host"]);
    expect(shown).toEqual([]);
    for (const target of ["android", "host"])
      expect(r.files.get(`${target}/m_m.cpp`)).toMatch(/LIMIT/);
    expect(r.proxies.get("m")).toMatch(/LIMIT/);
    expect(r.proxies.get("m")).toMatch(/Mode/);
  });

  it.skipIf(!jdk)(
    "runs its platform's implementation with them",
    () => {
      const { "user.lucent.ts": _, ...alone } = androidOnly;
      const { r, dir, shown } = build(alone, ["android"]);
      expect(shown).toEqual([]);
      expect(jvmRun(r, dir, android!.run)).toEqual({
        status: 0,
        stdout: "STAND-IN 3 plain\n",
        stderr: "",
      });
    },
    300_000,
  );

  it("still needs its declaration file", () => {
    const { shown } = build(
      { "lone.android.lucent.ts": "export function f(): number {\n  return 1;\n}\n" },
      ["android"],
    );
    expect(shown).toEqual([expect.stringMatching(/^LUCENT3005 .*lone\.lucent\.ts next to it/)]);
  });
});
