/**
 * The fixture C++ library (tally: a class, overloads, callbacks and
 * exceptions) and the C one that calls back from another thread (ticker),
 * run on the desktop JNI host (T142): the program's Android code, linked
 * with Lucent's JNI runtime and the libraries' own sources, as the app's
 * CMake builds them beside the runtime. The host run is the e2e cases'
 * (native-cxx-extension, native-callbacks).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { bindExtensions, type LucentPackage, resolveNative } from "../src/index.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

const fixture = (name: string, pkg: string): LucentPackage => {
  const dir = path.join(fixtures, name);
  return { name: pkg, version: "1.0.0", dir, sources: path.join(dir, "src") };
};

const module = `import { Counter, Rounding } from "lucent:ext/tally";
import { ticker_count_threaded } from "lucent:ext/ticker";

export async function run(): Promise<string> {
  const out: string[] = [];

  // An overload by its arguments' types, a listener C++ keeps and calls during later calls.
  const c = new Counter("jni", 2);
  const heard: string[] = [];
  c.onAdd((name, total) => heard.push(\`\${name}=\${total}\`));
  out.push(String(c.add(1.5)));
  c.setRounding(Rounding.Down);
  out.push(String(c.add(0.75)));

  // Callbacks during the call: one C++ calls in order, one whose result it counts.
  const amounts: number[] = [];
  c.each((amount) => amounts.push(amount));
  out.push(amounts.join(","));
  c.tag(["a", "bb"]);
  out.push(String(c.countTags((tag) => tag.length > 1)));

  // What C++ throws: a std::exception's what(), and anything else.
  try {
    c.add(-1);
  } catch (e) {
    out.push((e as Error).message);
  }
  try {
    c.fail();
  } catch (e) {
    out.push((e as Error).message);
  }
  out.push(heard.join(" "));
  out.push(String(Counter.live()));
  c.close();

  // A C library calling back from another thread: posted to the module's actor, after the call.
  const posted: number[] = [];
  ticker_count_threaded(1, 3, (value) => posted.push(value));
  out.push(\`during \${posted.length}\`);
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  out.push(posted.join(","));

  return out.join(" | ");
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cxx-jni-")), {});

describe.skipIf(!fake || !jdk || !clang)("a C++ extension on the JNI host", () => {
  it("constructs, calls back, throws and posts as on the JavaScript host", () => {
    const extensions = bindExtensions(
      resolveNative([fixture("tally", "lucent-tally"), fixture("ticker", "lucent-ticker")])
        .extensions,
    );
    const p = android(module, { android: { jars: fake!.bind } }, extensions);
    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);

    const native = (name: string) => path.join(fixtures, name, "native");
    expect(
      jvmRun(p.r, p.dir, fake!.run, undefined, undefined, false, {
        sources: [
          path.join(native("tally"), "tally.cpp"),
          path.join(native("ticker"), "ticker.cpp"),
        ],
        includes: [native("tally"), native("ticker")],
      }),
    ).toEqual({
      status: 0,
      stdout:
        "3 | 4 | 3,1 | 1 | add takes a number of at least 0 | Counter.fail threw a C++ exception | jni=3 jni=4 | 1 | during 0 | 1,2,3\n",
      stderr: "",
    });
  }, 300_000);
});
