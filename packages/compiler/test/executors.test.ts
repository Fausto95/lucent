import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";
import { hostRun, iosProgram, xcode } from "./swift-harness.ts";

/*
 * lucent:thread's executors (decisions 0078 and 0081): a serial executor of
 * its own, which Android APIs take as a java.util.concurrent.Executor, and
 * functions handed to the platform with on(executor, f), which run there
 * without their module's lock. Run on the desktop JNI host against the
 * JDK's java.util.concurrent, and on the macOS host against Foundation.
 */

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-executors-")), {});

/** The Android side of a module whose run() is `body`, compiled against the JDK's classes. */
function compiled(body: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-executors-"));
  const classpath = classpathFile(path.join(root, "android-classpath.json"), []);
  return android(body, { android: { jars: fake!.bind, classpath } });
}

const messages = (p: ReturnType<typeof compiled>) => p.r.diagnostics.map((d) => d.message);
/** The diagnostics, each with its code, one per line. */
const reported = (p: ReturnType<typeof compiled>) =>
  p.r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n");

const running = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture, Executors } from "lucent:android/java.util.concurrent";
import { Thread } from "lucent:android/java.lang";

export async function run(): Promise<string> {
  const frames = executor("lucent.frames");
  const out = new Channel<string>("lossless");
  const module = Thread.currentThread()?.getId() ?? 0n;

  // Handed to the platform: Java runs the Runnable on the executor, which enters it there.
  CompletableFuture.runAsync(
    on(frames, () => {
      const here = Thread.currentThread()?.getId() ?? 0n;
      out.send(here === module ? "on the module's thread" : "on the executor");
    }),
    frames,
  );
  const first = await out.receive();

  // Called from another thread (a pool's): posted to the executor, still off the module.
  const pool = Executors.newSingleThreadExecutor()!;
  pool.execute(
    on(frames, () => {
      out.send("posted");
    }),
  );
  const second = await out.receive();
  pool.shutdown();

  return \`\${frames.label} | \${first} | \${second}\`;
}
`;

describe.skipIf(!fake || !jdk)("executors on Android", () => {
  it("run a function handed over with on() on the executor, off its module's thread", () => {
    const p = compiled(running);

    expect(messages(p)).toEqual([]);
    expect(p.cpp).toContain("lucent::jni::executorOf");
    expect(p.cpp).toContain("lucent::enterOrPost(*x_");
    expect(jvmRun(p.r, p.dir, fake!.run)).toEqual({
      status: 0,
      stdout: "lucent.frames | on the executor | posted\n",
      stderr: "",
    });
  }, 300_000);
});

const runningOnApple = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { NSOperationQueue, NSThread } from "lucent:ios/Foundation";

export async function run(): Promise<string> {
  const frames = executor("lucent.frames");
  const out = new Channel<string>("lossless");
  const module = NSThread.currentThread.hash;

  // An operation queue on the executor's dispatch queue: its blocks run there, and enter at once.
  const queue = new NSOperationQueue();
  queue.underlyingQueue = frames;
  queue.addOperationWithBlock(
    on(frames, () => {
      const here = NSThread.currentThread.hash;
      out.send(here === module ? "on the module's thread" : "on the executor");
    }),
  );
  const first = await out.receive();

  // Called on another queue's thread: posted to the executor, still off the module.
  new NSOperationQueue().addOperationWithBlock(
    on(frames, () => {
      out.send("posted");
    }),
  );
  const second = await out.receive();

  return \`\${frames.label} | \${first} | \${second}\`;
}
`;

describe.skipIf(!xcode)("executors on iOS", () => {
  it("run a block handed over with on() on the executor's queue, off its module's thread", () => {
    const p = iosProgram(runningOnApple);

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.mm).toContain("lucent::objc::queueOf");
    expect(p.mm).toContain("lucent::enterOrPost(*x_");
    expect(hostRun(p)).toEqual({
      status: 0,
      stdout: "lucent.frames | on the executor | posted\n",
      stderr: "",
    });
  }, 300_000);
});

describe.skipIf(!fake || !jdk)("code on an executor", () => {
  const handing = (inner: string, before = "") => `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";

${before}
export async function run(): Promise<string> {
  const frames = executor("frames");
  const out = new Channel<number>("latest");
  CompletableFuture.runAsync(on(frames, ${inner}), frames);
  return "";
}
`;

  it("may not use module state, which its module's thread owns", () => {
    const p = compiled(handing("() => { count++; out.send(count); }", "let count = 0;"));
    expect(reported(p)).toMatch(/LUCENT3032 .*cannot run on an executor: it .*count/);
  });

  it("captures no variable its maker can assign", () => {
    const p = compiled(
      handing("() => { out.send(seen); }", "").replace(
        "const frames",
        "let seen = 0;\n  const frames",
      ),
    );
    expect(reported(p)).toMatch(/LUCENT3032 .*captures `seen`.*capture a `const`/);
  });

  it("captures no value its maker can change", () => {
    const p = compiled(
      handing("() => { sizes.push(1); out.send(sizes.length); }").replace(
        "const frames",
        "const sizes: number[] = [];\n  const frames",
      ),
    );
    expect(reported(p)).toMatch(
      /LUCENT3032 .*captures `sizes`.*make it inside the function, or send it through a Channel/,
    );
  });

  it("captures constants, channels and executors", () => {
    const p = compiled(
      handing("() => { out.send(limit + frames.label.length); }").replace(
        "const frames",
        "const limit = 3;\n  const frames",
      ),
    );
    expect(messages(p)).toEqual([]);
  });

  it("can't be async, or await", () => {
    const p = compiled(handing("async () => { out.send(1); }"));
    expect(reported(p)).toMatch(/LUCENT3032 .*cannot be async/);
  });

  it("is handed over where the platform takes it", () => {
    const p = compiled(`import { executor, on } from "lucent:thread";

export async function run(): Promise<string> {
  const frames = executor("frames");
  const later = on(frames, () => {});
  later();
  return frames.label;
}
`);
    expect(reported(p)).toMatch(/LUCENT1007 .*pass it straight to the SDK call that takes it/);
  });

  it("is a function literal, so the compiler sees what it runs", () => {
    const p = compiled(
      handing("tick").replace("const frames", "const tick = () => {};\n  const frames"),
    );
    expect(reported(p)).toMatch(/LUCENT1007 on\(\) takes a function literal/);
  });
});
