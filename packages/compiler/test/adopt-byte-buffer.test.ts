import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * adoptByteBuffer from lucent:android: a direct ByteBuffer's bytes as a
 * NativeBuffer, uncopied, which can then move to an ArrayBuffer for
 * JavaScript. A heap or read-only buffer is refused. Run on the desktop
 * JNI host against the JDK's java.nio.
 */

const library = {
  "dev/probe/Frames.java": `package dev.probe;
import java.nio.ByteBuffer;
public final class Frames {
  public static ByteBuffer direct() {
    ByteBuffer b = ByteBuffer.allocateDirect(4);
    for (int i = 0; i < 4; i++) b.put(i, (byte) (i + 1));
    return b;
  }
  public static ByteBuffer heap() { return ByteBuffer.allocate(4); }
  public static ByteBuffer readOnly() { return direct().asReadOnlyBuffer(); }
  public static int at(ByteBuffer b, int i) { return b.get(i) & 0xff; }
}
`,
};

const module = `import { NativeBuffer, type ByteSpan, type MutableByteSpan } from "lucent:core";
import { adoptByteBuffer } from "lucent:android";
import { Frames } from "lucent:android/dev.probe";

function joined(bytes: ByteSpan): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] ?? -1);
  return out.join(",");
}

function first(bytes: MutableByteSpan): void {
  bytes[0] = 9;
}

function refusal(make: () => NativeBuffer): string {
  try {
    return \`adopted \${make().byteLength}\`;
  } catch (e) {
    return \`\${(e as Error).name}: \${(e as Error).message}\`;
  }
}

export async function run(): Promise<string> {
  const out: string[] = [];
  const before = NativeBuffer.stats();
  const frame = Frames.direct()!;
  const buffer = adoptByteBuffer(frame);
  out.push(\`\${buffer.byteLength} \${buffer.withRead(joined)}\`);
  // The Java buffer's own memory: a write shows on both sides.
  buffer.withWrite(first);
  out.push(\`\${Frames.at(frame, 0)}\`);
  const after = NativeBuffer.stats();
  out.push(\`\${after.adopted - before.adopted} \${after.copies - before.copies}\`);
  const moved = buffer.transferToArrayBuffer();
  out.push(\`\${new Uint8Array(moved).join(",")} \${moved.byteLength}\`);
  out.push(refusal(() => adoptByteBuffer(Frames.heap()!)));
  out.push(refusal(() => adoptByteBuffer(Frames.readOnly()!)));
  return out.join(" | ");
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-adopt-byte-buffer-")), {});

describe.skipIf(!fake || !jdk)("adoptByteBuffer from lucent:android", () => {
  it("adopts a direct ByteBuffer's bytes uncopied, and refuses other buffers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-adopt-byte-buffer-"));
    const jar = javaJar(path.join(root, "frames.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout:
        "4 1,2,3,4" +
        " | 9" +
        " | 1 0" +
        " | 9,2,3,4 4" +
        " | TypeError: adoptByteBuffer needs a direct ByteBuffer (ByteBuffer.allocateDirect), not one over a Java array" +
        " | TypeError: adoptByteBuffer needs a writable ByteBuffer, not a read-only one\n",
      stderr: "",
    });
  }, 300_000);
});
