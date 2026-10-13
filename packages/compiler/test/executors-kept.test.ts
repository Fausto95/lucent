import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";
import { hostRun, iosProgram, xcode } from "./swift-harness.ts";

/*
 * A function on an executor kept in a const, `const listener = on(executor,
 * f)`: one platform object wherever it is handed over, so a listener added
 * with it is removed with it. Run on the desktop JNI host against a Java
 * registry that compares its listeners as Java does, and on the macOS host.
 */

const library = {
  "dev/probe/TickListener.java": `package dev.probe;
@FunctionalInterface
public interface TickListener { void onTick(int n); }
`,
  "dev/probe/TickObserver.java": `package dev.probe;
public interface TickObserver { void onTick(int n); void onEnd(); }
`,
  "dev/probe/Ticks.java": `package dev.probe;
import java.util.ArrayList;
import java.util.List;
public final class Ticks {
  private static final List<TickListener> listeners = new ArrayList<>();
  private static final List<TickObserver> observers = new ArrayList<>();
  public static synchronized void observe(TickObserver o) { if (!observers.contains(o)) observers.add(o); }
  public static synchronized boolean unobserve(TickObserver o) { return observers.remove(o); }
  public static synchronized int observing() { return observers.size(); }
  public static void tickObservers(int n) {
    List<TickObserver> now;
    synchronized (Ticks.class) { now = new ArrayList<>(observers); }
    for (TickObserver o : now) o.onTick(n);
  }
  public static synchronized void add(TickListener l) { if (!listeners.contains(l)) listeners.add(l); }
  public static synchronized boolean remove(TickListener l) { return listeners.remove(l); }
  public static synchronized int count() { return listeners.size(); }
  public static void tick(int n) {
    List<TickListener> now;
    synchronized (Ticks.class) { now = new ArrayList<>(listeners); }
    for (TickListener l : now) l.onTick(n);
  }
}
`,
};

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kept-")), {});

function compiled(body: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kept-"));
  const jar = javaJar(path.join(root, "probe.jar"), library);
  const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
  return { p: android(body, { android: { jars: fake!.bind, classpath } }), jar };
}

const reported = (p: ReturnType<typeof compiled>["p"]) =>
  p.r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n");

const kept = `import { Channel } from "lucent:core";
import { type Executor, executor, on } from "lucent:thread";
import { Ticks } from "lucent:android/dev.probe";
import { Thread } from "lucent:android/java.lang";

/** Listens on an executor until the function it returns stops it. */
function listen(ticks: Executor, channel: Channel<string>): () => boolean {
  const module = Thread.currentThread()?.getId() ?? 0n;
  const out = channel;
  const listener = on(ticks, (n: number) => {
    const here = Thread.currentThread()?.getId() ?? 0n;
    out.send(\`\${n} \${here === module ? "on the module's thread" : "on the executor"}\`);
  });
  // The same object each time: Java's registry adds it once.
  Ticks.add(listener);
  Ticks.add(listener);
  return () => Ticks.remove(listener);
}

export async function run(): Promise<string> {
  const ticks = executor("lucent.ticks");
  const out = new Channel<string>("lossless");
  const stop = listen(ticks, out);
  const added = Ticks.count();
  Ticks.tick(1);
  const heard = await out.receive();
  return \`\${added} | \${heard} | \${stop()} \${Ticks.count()} \${stop()}\`;
}
`;

const keptObject = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { type TickObserver, Ticks } from "lucent:android/dev.probe";
import { Thread } from "lucent:android/java.lang";

/** An observer of two methods, so it goes on the executor as an object. */
class Observer implements TickObserver {
  constructor(
    private readonly out: Channel<string>,
    private readonly module: bigint,
  ) {}

  onTick(n: number): void {
    const here = Thread.currentThread()?.getId() ?? 0n;
    this.out.send(\`\${n} \${here === this.module ? "on the module's thread" : "on the executor"}\`);
  }

  onEnd(): void {}
}

export async function run(): Promise<string> {
  const ticks = executor("lucent.ticks");
  const out = new Channel<string>("lossless");
  const observer = on(ticks, new Observer(out, Thread.currentThread()?.getId() ?? 0n));
  Ticks.observe(observer);
  Ticks.observe(observer);
  const added = Ticks.observing();
  Ticks.tickObservers(2);
  const heard = await out.receive();
  return \`\${added} | \${heard} | \${Ticks.unobserve(observer)} \${Ticks.observing()}\`;
}
`;

describe.skipIf(!fake || !jdk)("a function on an executor kept in a const, on Android", () => {
  it("is one Java object wherever it is handed over, so it is removed as it was added", () => {
    const { p, jar } = compiled(kept);

    expect(reported(p)).toEqual("");
    expect(p.cpp).toContain("lucent::handedFunction");
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout: "1 | 1 on the executor | true 0 false\n",
      stderr: "",
    });
  }, 300_000);

  it("keeps an object on an executor the same way", () => {
    const { p, jar } = compiled(keptObject);

    expect(reported(p)).toEqual("");
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout: "1 | 2 on the executor | true 0\n",
      stderr: "",
    });
  }, 300_000);

  const refused = (use: string) => `import { executor, on } from "lucent:thread";
import { Ticks } from "lucent:android/dev.probe";

function keep(f: (n: number) => void): void {}

export async function run(): Promise<string> {
  const ticks = executor("lucent.ticks");
  ${use}
  return "";
}
`;

  it("refuses one called, passed to Lucent code, or kept in a let", () => {
    const called = compiled(
      refused(`const listener = on(ticks, (n: number) => {});
  Ticks.add(listener);
  listener(1);`),
    ).p;
    expect(reported(called)).toContain(
      "LUCENT1007 `listener` is a function on an executor: it is only handed to the platform",
    );

    const passed = compiled(
      refused(`const listener = on(ticks, (n: number) => {});
  keep(listener);`),
    ).p;
    expect(reported(passed)).toContain(
      "LUCENT1007 `listener` is a function on an executor: it is only handed to the platform",
    );

    const variable = compiled(
      refused(`let listener = on(ticks, (n: number) => {});
  Ticks.add(listener);`),
    ).p;
    expect(reported(variable)).toContain("LUCENT1007 on() hands a function to the platform");

    const object = compiled(
      refused(`const observer = on(ticks, new Quiet());
  Ticks.observe(observer);
  observer.onEnd();`)
        .replace(
          "function keep",
          `class Quiet implements TickObserver {
  onTick(n: number): void {}
  onEnd(): void {}
}

function keep`,
        )
        .replace("import { Ticks }", "import { type TickObserver, Ticks }"),
    ).p;
    expect(reported(object)).toContain(
      "LUCENT1007 `observer` is an object on an executor: it is only handed to the platform",
    );
  }, 300_000);
});

const keptOnApple = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { OperationQueue, Thread } from "lucent:ios/Foundation";

export async function run(): Promise<string> {
  const frames = executor("lucent.frames");
  const out = new Channel<string>("lossless");
  Thread.current.name = "lucent.module";
  const report = on(frames, () => {
    out.send(Thread.current.name === "lucent.module" ? "on the module's thread" : "on the executor");
  });
  // One block, handed to two queues.
  new OperationQueue().addOperation(report);
  new OperationQueue().addOperation(report);
  return \`\${await out.receive()} | \${await out.receive()}\`;
}
`;

describe.skipIf(!xcode)("a function on an executor kept in a const, on iOS", () => {
  it("is one block wherever it is handed over, run on the executor", () => {
    const p = iosProgram(keptOnApple);

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.mm).toContain("lucent::handedFunction");
    expect(hostRun(p)).toEqual({
      status: 0,
      stdout: "on the executor | on the executor\n",
      stderr: "",
    });
  }, 300_000);
});
