import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * A 64-bit integer parameter (Java's long, Swift's Int) takes a bigint, or
 * a number that is a safe integer: checked, so a fraction or a number past
 * 2^53 − 1 throws RangeError rather than passing a rounded value. Results
 * stay bigints. Run on the desktop JNI host.
 */

const library = {
  "dev/probe/Wide.java": `package dev.probe;
public final class Wide {
  private final long start;
  public Wide(long start) { this.start = start; }
  public long plus(long n) { return start + n; }
  public static long twice(long n) { return n * 2; }
  public static long sum(long[] values) {
    long total = 0;
    for (long v : values) total += v;
    return total;
  }
}
`,
};

const module = `import { Wide } from "lucent:android/dev.probe";

function attempt(f: () => bigint): string {
  try {
    return String(f());
  } catch (e) {
    return \`\${(e as Error).name}: \${(e as Error).message}\`;
  }
}

export async function run(): Promise<string> {
  const n: number = 21;
  return [
    attempt(() => Wide.twice(n)),
    attempt(() => Wide.twice(4n)),
    attempt(() => new Wide(40).plus(2)),
    attempt(() => Wide.twice(-9007199254740991)),
    attempt(() => Wide.twice(1.5)),
    attempt(() => Wide.twice(2 ** 53)),
    attempt(() => Wide.twice(Number.NaN)),
    attempt(() => Wide.sum([1n, 2n])),
  ].join(" | ");
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-wide-")), {});

describe.skipIf(!fake || !jdk)("64-bit integer parameters", () => {
  it("take a bigint, or a number that is a safe integer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-wide-"));
    const jar = javaJar(path.join(root, "wide.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout:
        "42 | 8 | 42 | -18014398509481982" +
        " | RangeError: arg0 of Wide.twice: 1.5 is not a safe integer" +
        " | RangeError: arg0 of Wide.twice: 9007199254740992 is not a safe integer" +
        " | RangeError: arg0 of Wide.twice: NaN is not a safe integer" +
        " | 3\n",
      stderr: "",
    });
  }, 300_000);
});
