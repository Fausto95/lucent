/**
 * A Lucent package calling its own Kotlin and Java (T143, decision 0132):
 * fixtures/greeter's android.nativeSources, compiled into the jar Lucent
 * binds lucent:android/dev.example.greet from, called by the package's
 * Lucent code (a default left out goes through a Kotlin shim), and run on
 * the desktop JNI host with the classes Gradle would compile into the app.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { androidSourcesJar } from "@lucent-lang/bindgen";
import { kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { compile, resolveNative, type SdkOptions } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

const fixture = path.join(import.meta.dirname, "fixtures/greeter");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;
const tc = kotlinToolchain();

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-greeter-jni-")), {});

describe.skipIf(!fake || !jdk || !clang || !tc)("a package's own Kotlin and Java", () => {
  it("bind for its Lucent code, which calls them on the JNI host", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-greeter-"));
    const pkg = path.join(dir, "greeter");
    fs.cpSync(fixture, pkg, { recursive: true });

    const native = resolveNative([
      { name: "lucent-greeter", version: "1.0.0", dir: pkg, sources: path.join(pkg, "src") },
    ]);
    expect(native.jvmSources.map((f) => path.relative(pkg, f))).toEqual([
      "android/dev/example/greet/Greeter.kt",
      "android/dev/example/greet/java/Polite.java",
    ]);

    const files: Record<string, string> = {
      "m.lucent.ts": "export declare function run(): Promise<string>;\n",
      "m.ios.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
      "m.android.lucent.ts": `import { greetings } from "./greeter/src/greet.lucent";

export async function run(): Promise<string> {
  return greetings("ada");
}
`,
    };
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

    const sdk: SdkOptions = { android: { jars: fake!.bind, sources: native.jvmSources } };
    const r = compile(
      [
        ...Object.keys(files).map((f) => path.join(dir, f)),
        ...["greet.lucent.ts", "greet.ios.lucent.ts", "greet.android.lucent.ts"].map((f) =>
          path.join(pkg, "src", f),
        ),
      ],
      { platforms: ["android"], sdk },
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    // The classes Gradle compiles into the app: here, the jar Lucent bound.
    const built = androidSourcesJar(sdk);
    expect(built).toMatchObject({ jar: expect.any(String) });
    const classpath = [
      ...fake!.run,
      (built as { jar: string }).jar,
      path.join(tc!.lib, "kotlin-stdlib.jar"),
    ];

    expect(jvmRun(r, dir, classpath, tc)).toEqual({
      status: 0,
      stdout: "hello ada | 3 | lucent,jni | please, ada | please, ada | hi you | hi ada\n",
      stderr: "",
    });
  }, 300_000);
});
