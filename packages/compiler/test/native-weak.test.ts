import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * A WeakRef to a platform object, and WeakMap and WeakSet keyed by one
 * (T112): held through the platform's weak reference, so the object lives
 * while the platform or Lucent holds it, and goes with the collector. Run
 * on the desktop JNI host, whose JVM collects at System.gc().
 */

const library = {
  "dev/probe/Peer.java": `package dev.probe;
public final class Peer {
  private static Peer kept;
  public Peer() {}
  public static Peer keep(Peer peer) { kept = peer; return peer; }
  public static Peer kept() { return kept; }
  public static void release() { kept = null; }
  public static void collect() throws InterruptedException {
    for (int i = 0; i < 5; i++) { System.gc(); Thread.sleep(20); }
  }
}
`,
};

const module = `import { Peer } from "lucent:android/dev.probe";

// A delegate's back reference to its owner, as a platform delegate keeps one.
class Delegate {
  readonly owner: WeakRef<Peer>;
  constructor(owner: Peer) {
    this.owner = new WeakRef(owner);
  }
}

const labels = new WeakMap<Peer, string>();
const seen = new WeakSet<Peer>();

function adopt(): Delegate {
  const peer = Peer.keep(new Peer())!;
  labels.set(peer, "first");
  seen.add(peer);
  return new Delegate(peer);
}

function check(delegate: Delegate): string {
  // Another reference to the object the platform keeps: the same key.
  const kept = Peer.kept()!;
  const found = \`\${delegate.owner.deref() === kept} \${labels.get(kept)} \${seen.has(kept)}\`;
  const other = new Peer();
  const removed = \`\${labels.delete(kept)} \${labels.has(kept)} \${labels.has(other)} \${seen.has(other)}\`;
  return \`\${found} | \${removed}\`;
}

export async function run(): Promise<string> {
  const delegate = adopt();
  const before = check(delegate);
  Peer.release();
  Peer.collect();
  return \`\${before} | \${delegate.owner.deref() === undefined}\`;
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-weak-")), {});

describe.skipIf(!fake || !jdk)("weak references to Android objects", () => {
  it("keep the object while the platform holds it, and let the collector take it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-weak-"));
    const jar = javaJar(path.join(root, "probe.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.cpp).toContain("lucent::WeakRefObject<lucent::NativeRef>");
    expect(p.cpp).toContain("lucent::WeakMap<lucent::NativeRef, lucent::String>");
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout: "true first true | true false false false | true\n",
      stderr: "",
    });
  }, 300_000);
});
