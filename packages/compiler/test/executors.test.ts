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
import { OperationQueue, Thread } from "lucent:ios/Foundation";

export async function run(): Promise<string> {
  const frames = executor("lucent.frames");
  const out = new Channel<string>("lossless");
  // The module's thread, named so the executor's can be told from it.
  Thread.current.name = "lucent.module";

  // An operation queue on the executor's dispatch queue: its blocks run there, and enter at once.
  const queue = new OperationQueue();
  queue.underlyingQueue = frames;
  queue.addOperation(
    on(frames, () => {
      const here = Thread.current.name;
      out.send(here === "lucent.module" ? "on the module's thread" : "on the executor");
    }),
  );
  const first = await out.receive();

  // Called on another queue's thread: posted to the executor, still off the module.
  new OperationQueue().addOperation(
    on(frames, () => {
      out.send("posted");
    }),
  );
  const second = await out.receive();

  return \`\${frames.label} | \${first} | \${second}\`;
}
`;

const delegateOnApple = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { Thread, XMLParser, type XMLParserDelegate } from "lucent:ios/Foundation";

/** Reports where the parser's last call ran. */
class Ends implements XMLParserDelegate {
  constructor(private readonly out: Channel<string>) {}

  parserDidEndDocument(_parser: XMLParser): void {
    const here = Thread.current.name;
    this.out.send(here === "lucent.module" ? "on the module's thread" : "on the executor");
  }
}

export async function run(): Promise<string> {
  const frames = executor("lucent.xml");
  const out = new Channel<string>("lossless");
  // The module's thread, named so the executor's can be told from it.
  Thread.current.name = "lucent.module";
  // parse() calls its delegate at once, on the module's thread: posted to the executor.
  const parser = new XMLParser(new Uint8Array([60, 97, 47, 62]));
  parser.delegate = on(frames, new Ends(out));
  parser.parse();
  return (await out.receive()) ?? "";
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

describe.skipIf(!xcode)("objects on an executor on iOS", () => {
  it("run a delegate's methods on the executor, off its module's thread", () => {
    const p = iosProgram(delegateOnApple);

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.mm).toContain("lucent::onExecutor");
    expect(p.mm).toMatch(/lucent::enterOrPost\(\*\(?self->self_->lucentExecutor_/);
    expect(hostRun(p)).toEqual({ status: 0, stdout: "on the executor\n", stderr: "" });
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

  it("types the function's parameters from the SDK call that takes it", () => {
    const p = compiled(`import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";

export async function run(): Promise<string> {
  const frames = executor("frames");
  const out = new Channel<number>("latest");
  CompletableFuture.completedFuture("four")?.thenAcceptAsync(
    on(frames, (word) => {
      out.send(word?.length ?? 0);
    }),
    frames,
  );
  return \`\${(await out.receive()) ?? 0}\`;
}
`);
    expect(messages(p)).toEqual([]);
    expect(jvmRun(p.r, p.dir, fake!.run)).toMatchObject({ status: 0, stdout: "4\n" });
  }, 300_000);

  it("posts a function that answers nothing to the executor when the platform calls it elsewhere", () => {
    // thenAccept runs its Consumer at once, on the calling thread: the module's, not the executor's.
    const p = compiled(`import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";
import { Thread } from "lucent:android/java.lang";

export async function run(): Promise<string> {
  const frames = executor("frames");
  const out = new Channel<string>("latest");
  const module = Thread.currentThread()?.getId() ?? 0n;
  CompletableFuture.completedFuture("now")?.thenAccept(
    on(frames, (word) => {
      const here = Thread.currentThread()?.getId() ?? 0n;
      out.send(\`\${word} \${here === module ? "on the module's thread" : "on the executor"}\`);
    }),
  );
  return (await out.receive()) ?? "";
}
`);
    expect(messages(p)).toEqual([]);
    expect(jvmRun(p.r, p.dir, fake!.run)).toMatchObject({
      status: 0,
      stdout: "now on the executor\n",
    });
  }, 300_000);

  it("hands the platform its own functions on an executor too", () => {
    const p = compiled(
      handing(`() => {
    CompletableFuture.runAsync(on(frames, () => { out.send(2); }), frames);
    out.send(1);
  }`),
    );
    expect(messages(p)).toEqual([]);
  });

  it("shares nothing with a function it hands the platform without on()", () => {
    const p = compiled(
      handing(`() => {
    let n = 0;
    CompletableFuture.runAsync(() => { n++; });
    out.send(n);
  }`),
    );
    expect(reported(p)).toMatch(
      /LUCENT3032 .*is made on an executor but runs in its module .*captures `n`/,
    );
  });

  it("shares nothing with what the functions it calls hand over", () => {
    const p = compiled(
      handing(
        "() => { relay(out); }",
        `function relay(out: Channel<number>): void {
  let n = 0;
  CompletableFuture.runAsync(() => { n++; });
  out.send(n);
}`,
      ),
    );
    expect(reported(p)).toMatch(/LUCENT3032 .*is made on an executor .*captures `n`/);
  });

  it("gives the platform no object of its own", () => {
    const p = compiled(
      handing(
        "() => { new Thread(new Job()).start(); out.send(1); }",
        `import { Runnable, Thread } from "lucent:android/java.lang";
class Job implements Runnable {
  run(): void {}
}`,
      ),
    );
    expect(reported(p)).toMatch(/LUCENT3032 code on an executor gives the platform `Job`/);
  });

  it("is handed over where the platform takes it", () => {
    const p = compiled(`import { executor, on } from "lucent:thread";

export async function run(): Promise<string> {
  const frames = executor("frames");
  let later = on(frames, () => {});
  return frames.label;
}
`);
    expect(reported(p)).toMatch(/LUCENT1007 .*pass it straight to the SDK call that takes it/);

    // Kept in a const, it is still only handed over.
    const called = compiled(`import { executor, on } from "lucent:thread";

export async function run(): Promise<string> {
  const frames = executor("frames");
  const later = on(frames, () => {});
  later();
  return frames.label;
}
`);
    expect(reported(called)).toMatch(
      /LUCENT1007 `later` is a function on an executor: it is only handed to the platform/,
    );
  });

  it("is a function literal, so the compiler sees what it runs", () => {
    const p = compiled(
      handing("tick").replace("const frames", "const tick = () => {};\n  const frames"),
    );
    expect(reported(p)).toMatch(/LUCENT1007 on\(\) takes a function literal/);
  });
});

const jobs = `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture, Executors } from "lucent:android/java.util.concurrent";
import { Runnable, Thread } from "lucent:android/java.lang";

/** Counts its runs: state of its own, which only the executor touches. */
class Job implements Runnable {
  private runs = 0;

  constructor(
    private readonly out: Channel<string>,
    private readonly module: bigint,
  ) {}

  run(): void {
    this.runs++;
    const here = Thread.currentThread()?.getId() ?? 0n;
    this.out.send(\`\${here === this.module ? "on the module's thread" : "on the executor"} \${this.runs}\`);
  }
}

export async function run(): Promise<string> {
  const frames = executor("lucent.jobs");
  const out = new Channel<string>("lossless");
  const module = Thread.currentThread()?.getId() ?? 0n;

  // Java runs it on the executor, which it enters at once.
  CompletableFuture.runAsync(on(frames, new Job(out, module)), frames);
  const first = await out.receive();

  // A pool's thread calls it: posted to the executor.
  const pool = Executors.newSingleThreadExecutor()!;
  pool.execute(on(frames, new Job(out, module)));
  const second = await out.receive();
  pool.shutdown();

  return \`\${first} | \${second}\`;
}
`;

describe.skipIf(!fake || !jdk)("objects on an executor", () => {
  it("run their methods on the executor, off their module's thread", () => {
    const p = compiled(jobs);

    expect(messages(p)).toEqual([]);
    expect(p.cpp).toContain("lucent::onExecutor");
    expect(jvmRun(p.r, p.dir, fake!.run)).toEqual({
      status: 0,
      stdout: "on the executor 1 | on the executor 1\n",
      stderr: "",
    });
  }, 300_000);

  /** A module whose Job class goes on an executor, with `job` in place of its body and `make` in run(). */
  const handing = (
    job: string,
    make = "new Job(out)",
    before = "",
  ) => `import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";
import { Runnable } from "lucent:android/java.lang";

${before}
class Job implements Runnable {
  constructor(private readonly out: Channel<number>) {}
${job}
}

export async function run(): Promise<string> {
  const frames = executor("frames");
  const out = new Channel<number>("latest");
  CompletableFuture.runAsync(on(frames, ${make}), frames);
  return "";
}
`;

  it("may not use module state in their methods", () => {
    const p = compiled(
      handing("  run(): void { total++; this.out.send(total); }", undefined, "let total = 0;"),
    );
    expect(reported(p)).toMatch(/LUCENT3032 .*cannot run on an executor: it .*total/);
  });

  it("keep `this` to themselves", () => {
    const p = compiled(
      handing("  run(): void { keep(this); }", undefined, "function keep(_job: Runnable): void {}"),
    );
    expect(reported(p)).toMatch(/LUCENT3032 `this` leaves `Job` here/);
  });

  it("are given only what both sides may use", () => {
    const p = compiled(
      handing(
        "  constructor(private readonly sizes: number[]) {}\n  run(): void {}",
        "new Job([1, 2])",
      ).replace("  constructor(private readonly out: Channel<number>) {}\n", ""),
    );
    expect(reported(p)).toMatch(/LUCENT3032 `new Job\(…\)` goes on an executor.*`\[1, 2\]`/);
  });

  it("are made only where they go on an executor", () => {
    const p = compiled(
      handing("  run(): void { this.out.send(1); }").replace(
        '  const out = new Channel<number>("latest");',
        '  const out = new Channel<number>("latest");\n  const spare = new Job(out);\n  spare.run();',
      ),
    );
    expect(reported(p)).toMatch(
      /LUCENT3032 `Job` goes on an executor, so it is made only where it does/,
    );
  });

  it("are handed straight to the platform, or kept in a const", () => {
    const p = compiled(
      handing("  run(): void {}").replace(
        "CompletableFuture.runAsync(on(frames, new Job(out)), frames);",
        "let job = on(frames, new Job(out));\n  CompletableFuture.runAsync(job, frames);",
      ),
    );
    expect(reported(p)).toMatch(/LUCENT1007 on\(\) hands an object to the platform/);
  });

  it("extend no class", () => {
    const p = compiled(
      handing("  run(): void {}", undefined, "class Base {}")
        .replace("class Job implements Runnable {", "class Job extends Base implements Runnable {")
        .replace(
          "constructor(private readonly out: Channel<number>) {}",
          "constructor(private readonly out: Channel<number>) {\n    super();\n  }",
        ),
    );
    expect(reported(p)).toMatch(/LUCENT3032 `Job` extends a class/);
  });

  it("go on an executor from code on one", () => {
    const p = compiled(`import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";
import { Runnable } from "lucent:android/java.lang";

class Job implements Runnable {
  constructor(private readonly out: Channel<number>) {}
  run(): void { this.out.send(2); }
}

export async function run(): Promise<string> {
  const frames = executor("frames");
  const out = new Channel<number>("latest");
  CompletableFuture.runAsync(
    on(frames, () => {
      CompletableFuture.runAsync(on(frames, new Job(out)), frames);
    }),
    frames,
  );
  return \`\${(await out.receive()) ?? 0}\`;
}
`);
    expect(messages(p)).toEqual([]);
    expect(jvmRun(p.r, p.dir, fake!.run)).toMatchObject({ status: 0, stdout: "2\n" });
  }, 300_000);
});

const emitting = `import { Channel, EventEmitter } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";
import { Runnable, Thread } from "lucent:android/java.lang";

const events = new EventEmitter<{ frame: (size: number, where: string) => void }>();

/** Emits from its own state, on the executor. */
class Frames implements Runnable {
  private count = 0;

  constructor(private readonly events: EventEmitter<{ frame: (size: number, where: string) => void }>) {}

  run(): void {
    this.count++;
    this.events.emit("frame", this.count * 10, "from an object");
  }
}

export async function run(): Promise<string> {
  const frames = executor("frames");
  const heard = new Channel<string>("lossless");
  const module = Thread.currentThread()?.getId() ?? 0n;
  events.addListener("frame", (size, where) => {
    const here = Thread.currentThread()?.getId() ?? 0n;
    heard.send(\`\${size} \${where}, heard \${here === module ? "on the module's thread" : "elsewhere"}\`);
  });

  // What the function emits through goes to the emitter's module, which runs its listeners.
  const ev = events;
  CompletableFuture.runAsync(
    on(frames, () => {
      const here = Thread.currentThread()?.getId() ?? 0n;
      ev.emit("frame", 3, here === module ? "from the module" : "from the executor");
    }),
    frames,
  );
  const first = await heard.receive();

  CompletableFuture.runAsync(on(frames, new Frames(events)), frames);
  const second = await heard.receive();

  return \`\${first} | \${second}\`;
}
`;

describe.skipIf(!fake || !jdk)("events from an executor", () => {
  it("are emitted in the emitter's module, which runs the listeners", () => {
    const p = compiled(emitting);

    expect(messages(p)).toEqual([]);
    expect(p.cpp).toContain("lucent::transportCopy");
    expect(jvmRun(p.r, p.dir, fake!.run)).toEqual({
      status: 0,
      stdout:
        "3 from the executor, heard on the module's thread" +
        " | 10 from an object, heard on the module's thread\n",
      stderr: "",
    });
  }, 300_000);

  const handing = (
    inner: string,
    before = "",
  ) => `import { Channel, EventEmitter } from "lucent:core";
import { executor, on } from "lucent:thread";
import { CompletableFuture } from "lucent:android/java.util.concurrent";

const events = new EventEmitter<{ tick: (n: number) => void; job: (done: () => void) => void }>();
${before}
export async function run(): Promise<string> {
  const frames = executor("frames");
  const ev = events;
  CompletableFuture.runAsync(on(frames, ${inner}), frames);
  return "";
}
`;

  it("only emit on an emitter", () => {
    const p = compiled(handing(`() => { ev.addListener("tick", (_n) => {}); }`));
    // The listeners are the emitter's module's: adding one there is a write of its state.
    expect(reported(p)).toMatch(
      /LUCENT3032 (code on an executor only emits on an emitter|.*addListener`, which may be module state `events`)/,
    );
  });

  it("emit only what can be copied", () => {
    const p = compiled(handing(`() => { ev.emit("job", () => {}); }`));
    expect(reported(p)).toMatch(/LUCENT3032 an event emitted on an executor is copied/);
  });

  it("emit in the function on the executor, not in a helper that runs listeners", () => {
    const p = compiled(
      handing(
        "() => { tick(ev); }",
        `function tick(e: EventEmitter<{ tick: (n: number) => void; job: (done: () => void) => void }>): void {
  e.emit("tick", 1);
}`,
      ),
    );
    expect(reported(p)).toMatch(/LUCENT3032 .*cannot run on an executor: it calls `tick`/);
  });

  it("read no module emitter of their own", () => {
    const p = compiled(handing(`() => { events.emit("tick", 1); }`));
    expect(reported(p)).toMatch(/LUCENT3032 .*cannot run on an executor: it .*`events`/);
  });
});
