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
 * handleOf from lucent:android: a direct ByteBuffer's address as a
 * NativeHandle, the Java buffer held until it is released, for native code
 * that takes a pointer. A heap buffer, with no address of its own, is
 * refused. Run on the desktop JNI host against the JDK's java.nio. And
 * retainedHandle from lucent:ios, an object's address retained until
 * released, on the macOS host.
 */

const library = {
  "dev/probe/Frames.java": `package dev.probe;
import java.nio.ByteBuffer;
public final class Frames {
  public static ByteBuffer direct() { return ByteBuffer.allocateDirect(16); }
  public static ByteBuffer heap() { return ByteBuffer.allocate(16); }
}
`,
};

const module = `import { adoptByteBuffer, handleOf } from "lucent:android";
import { Frames } from "lucent:android/dev.probe";

export async function run(): Promise<string> {
  const out: string[] = [];
  const frame = Frames.direct()!;

  // The bytes' own address: the one their adopted buffer's handle gives.
  const handle = handleOf(frame);
  const adopted = adoptByteBuffer(frame).handle();
  out.push(\`\${handle.pointer !== 0n} \${handle.pointer === adopted.pointer}\`);
  adopted.release();

  // Released once, from whichever side.
  out.push(\`\${handle.release()} \${handle.release()} \${handle.released} \${handle.pointer}\`);

  try {
    handleOf(Frames.heap()!);
    out.push("heap: a handle");
  } catch (e) {
    out.push(\`\${(e as Error).name}: \${(e as Error).message}\`);
  }
  return out.join(" | ");
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-handles-")), {});

describe.skipIf(!fake || !jdk)("handleOf from lucent:android", () => {
  it("gives a direct ByteBuffer's address, held until it is released", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-handles-"));
    const jar = javaJar(path.join(root, "probe.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.cpp).toContain("lucent::jni::byteBufferHandle");
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout:
        "true true | true false true 0 | TypeError: handleOf needs a direct ByteBuffer" +
        " (ByteBuffer.allocateDirect), not one over a Java array\n",
      stderr: "",
    });
  }, 300_000);
});

const retaining = `import { retainedHandle } from "lucent:ios";
import { OperationQueue } from "lucent:ios/Foundation";

export async function run(): Promise<string> {
  const queue = new OperationQueue();
  // Each handle retains the object: the same address, released once each.
  const first = retainedHandle(queue);
  const second = retainedHandle(queue);
  const same = first.pointer !== 0n && first.pointer === second.pointer;
  return \`\${same} \${first.release()} \${first.release()} \${second.released} \${second.release()}\`;
}
`;

describe.skipIf(!xcode)("retainedHandle from lucent:ios", () => {
  it("gives an object's address, retained until it is released", () => {
    const p = iosProgram(retaining);

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(p.mm).toContain("lucent::objc::retainedHandle");
    expect(hostRun(p)).toEqual({ status: 0, stdout: "true true false false true\n", stderr: "" });
  }, 300_000);
});
