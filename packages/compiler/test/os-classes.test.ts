import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { android as androidModule } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * Android classes the OS makes (decision 0097): an exported Lucent class
 * extending an Android class has a Java class the OS makes by name, whose
 * constructor makes the Lucent side through the native root. A stand-in
 * for the OS makes it by reflection, as WorkManager makes a Worker, on the
 * desktop JNI host.
 */

const standIns = {
  // A base whose one constructor takes an argument, as a Worker's does.
  "dev/fake/Job.java": `package dev.fake;
public abstract class Job {
  private final String label;
  public Job(String label) { this.label = label; }
  public String getLabel() { return label; }
  public abstract String work();
}
`,
  // What WorkManager does with a worker's class name.
  "dev/fake/Os.java": `package dev.fake;
public final class Os {
  public static String make(String name, String label) throws Exception {
    Job job = (Job) Class.forName(name).getConstructor(String.class).newInstance(label);
    return job.work() + ", again " + job.work();
  }
  public static String fail(String name) {
    try {
      Class.forName(name).getConstructor(String.class).newInstance("bad");
      return "made";
    } catch (java.lang.reflect.InvocationTargetException e) {
      return e.getCause().getMessage();
    } catch (Exception e) {
      return e.toString();
    }
  }
}
`,
};

const module = `import { Job, Os } from "lucent:android/dev.fake";

let made = 0;

export class Echo extends Job {
  private readonly n: number;

  constructor(label: string) {
    super(label);
    if (label === "bad") throw new RangeError("no bad jobs");
    made++;
    this.n = made;
  }

  // The base's getLabel(), on the object the OS made.
  work(): string {
    return \`\${this.getLabel()} #\${this.n}\`;
  }
}

export async function run(): Promise<string> {
  const first = Os.make("dev.lucent.app.m.Echo", "first") ?? "";
  const second = Os.make("dev.lucent.app.m.Echo", "second") ?? "";
  const failed = Os.fail("dev.lucent.app.m.Echo") ?? "";
  return \`\${first} | \${second} | \${failed} | made \${made}\`;
}
`;

const android = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-os-")), standIns);

/** A module whose Android side is `src`, against the stand-ins: its class isn't JavaScript's to declare. */
function build(src: string) {
  const { r, dir } = androidModule(src, { android: { jars: android!.bind } });
  return { r, dir, shown: r.diagnostics.map((d) => `${d.code} ${d.line}: ${d.message}`) };
}

describe.skipIf(!android || !jdk)("Android classes the OS makes", () => {
  it("have a Java class named for the module, which makes the Lucent side when the OS makes it", () => {
    const { r, dir, shown } = build(module);
    expect(shown).toEqual([]);

    const java = r.java?.get("dev/lucent/app/m/Echo.java") ?? "";
    expect(java).toContain("package dev.lucent.app.m;");
    expect(java).toContain("public final class Echo extends dev.fake.Job {");
    expect(java).toContain("  public Echo(java.lang.String a0) {");
    expect(java).toContain('NativeProxy.adopt(this, "dev/lucent/app/m/Echo", new Object[] {a0});');
    // Only the OS makes it: the base has no constructor without arguments.
    expect(java).not.toContain("public Echo(long handle)");

    expect(jvmRun(r, dir, android!.run)).toEqual({
      status: 0,
      stdout: "first #1, again first #1 | second #2, again second #2 | no bad jobs | made 2\n",
      stderr: "",
    });
  }, 300_000);

  it("pass the constructor's parameters to the base, unchanged", () => {
    const { shown } = build(module.replace("super(label);", 'super("x");'));
    expect(shown).toEqual([
      "LUCENT1005 9: Echo: the OS makes it, so super(…) passes the constructor's parameters, unchanged and in order",
    ]);
  });
});
