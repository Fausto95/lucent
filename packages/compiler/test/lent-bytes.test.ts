import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { compile } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk } from "./jni-harness.ts";

/*
 * Which byte arguments a synchronous export reads in place: those its body
 * only reads, while it runs. Bytes it writes, keeps, returns, captures or
 * hands to code that might do any of these are copied, as before.
 */

/** Each export of `source`, mapped to how its first argument converts: "borrow" or "fromJs". */
function conversions(source: string): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lent-bytes-"));
  const file = path.join(dir, "m.lucent.ts");
  fs.writeFileSync(file, source);
  const r = compile([file]);
  expect(r.diagnostics).toEqual([]);

  return byExport(r.files.get("lucent_bindings.cpp") ?? "");
}

function byExport(bindings: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of bindings.split("defineFunction(rt, exports, ").slice(1)) {
    const name = /^"(\w+)"/.exec(chunk)?.[1];
    const how = /auto a0 = Convert<lucent::(?:Bytes|ArrayBuffer|\w+Array|DataView)>::(\w+)\(/.exec(
      chunk,
    )?.[1];
    if (name) out[name] = how ?? "other";
  }
  return out;
}

describe("byte arguments read in place", () => {
  it("lends what a synchronous export only reads", () => {
    expect(
      conversions(`
export function indexed(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i] ?? 0;
  return total + bytes.byteLength + bytes.byteOffset;
}

export function iterated(bytes: Uint8Array): number {
  let total = 0;
  for (const b of bytes) total += b;
  return total;
}

export function methods(bytes: Uint8Array): string {
  return \`\${bytes.join(",")} \${bytes.indexOf(1)} \${bytes.includes(2)} \${bytes.slice(1).length}\`;
}

export function viewed(buffer: ArrayBuffer): number {
  const view = new Uint8Array(buffer, 1);
  const tail = view.subarray(1);
  return (view[0] ?? 0) + tail.length + buffer.byteLength + buffer.slice(1).byteLength;
}

export function spread(bytes: Uint8Array): number {
  return [...bytes].length + Array.from(bytes).length + new Uint8Array(bytes.buffer).length;
}
`),
    ).toEqual({
      indexed: "borrow",
      iterated: "borrow",
      methods: "borrow",
      viewed: "borrow",
      spread: "borrow",
    });
  });

  it("lends other typed arrays, and buffers read through views of any kind", () => {
    expect(
      conversions(`
export function samples(s: Float32Array): number {
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  return peak + (s.at(-1) ?? 0) + s.toSorted()[0]! + s.with(0, 1)[0]!;
}

export function words(buffer: ArrayBuffer): number {
  const w = new Uint16Array(buffer, 0, 2);
  const d = new DataView(buffer);
  return (w[1] ?? 0) + d.getUint16(0) + d.getFloat32(0, true);
}

export function big(b: BigInt64Array): bigint {
  return b[0] ?? 0n;
}

export function setThrough(buffer: ArrayBuffer): number {
  const d = new DataView(buffer);
  d.setUint8(0, 1);
  return d.byteLength;
}

export function sorted(s: Int16Array): number {
  s.sort();
  return s.length;
}

export function each(s: Int16Array): number {
  let n = 0;
  s.forEach((x, i, all) => {
    n += all[i] ?? x;
  });
  return n;
}
`),
    ).toEqual({
      samples: "borrow",
      words: "borrow",
      big: "borrow",
      setThrough: "fromJs",
      sorted: "fromJs",
      each: "fromJs",
    });
  });

  it("copies what an export writes, keeps, returns, captures or passes on", () => {
    expect(
      conversions(`
let kept: Uint8Array = new Uint8Array(0);

function helper(bytes: Uint8Array): number {
  return bytes.length;
}

export function written(bytes: Uint8Array): number {
  bytes[0] = 1;
  return bytes.length;
}

export function compound(bytes: Uint8Array): number {
  bytes[0] ??= 1;
  return bytes.length;
}

export function filled(bytes: Uint8Array): number {
  bytes.fill(0);
  return bytes.length;
}

export function viewWritten(buffer: ArrayBuffer): number {
  const view = new Uint8Array(buffer);
  view[0] = 1;
  return view.length;
}

export function stored(bytes: Uint8Array): number {
  kept = bytes;
  return kept.length;
}

export function aliasStored(bytes: Uint8Array): number {
  const alias = bytes;
  kept = alias;
  return alias.length;
}

export function returned(bytes: Uint8Array): Uint8Array {
  return bytes;
}

export function captured(bytes: Uint8Array): number {
  const read = () => bytes[0] ?? 0;
  return read();
}

export function passed(bytes: Uint8Array): number {
  return helper(bytes);
}

export function inObject(bytes: Uint8Array): number {
  const o = { bytes };
  return o.bytes.length;
}

export function reassigned(bytes: Uint8Array): number {
  bytes = new Uint8Array(2);
  return bytes.length;
}

export async function later(bytes: Uint8Array): Promise<number> {
  return bytes.length;
}

export function optional(bytes?: Uint8Array): number {
  return bytes?.length ?? 0;
}
`),
    ).toEqual({
      written: "fromJs",
      compound: "fromJs",
      filled: "fromJs",
      viewWritten: "fromJs",
      stored: "fromJs",
      aliasStored: "fromJs",
      returned: "fromJs",
      captured: "fromJs",
      passed: "fromJs",
      inObject: "fromJs",
      reassigned: "fromJs",
      later: "fromJs",
      optional: "other",
    });
  });

  const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lent-bytes-")), {});

  it.skipIf(!fake || !jdk)(
    "lends bytes passed to an SDK call, which copies them",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lent-bytes-"));
      const jar = javaJar(path.join(root, "store.jar"), {
        "dev/probe/Store.java": `package dev.probe;
public final class Store {
  public static int put(String key, byte[] value) { return value.length; }
}
`,
      });
      const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
      const files = {
        "m.lucent.ts": "export declare function set(key: string, value: Uint8Array): number;\n",
        "m.ios.lucent.ts":
          "export function set(key: string, value: Uint8Array): number {\n  return value.length;\n}\n",
        "m.android.lucent.ts": `import { Store } from "lucent:android/dev.probe";

export function set(key: string, value: Uint8Array): number {
  return Store.put(key, value);
}
`,
      };
      for (const [name, text] of Object.entries(files))
        fs.writeFileSync(path.join(root, name), text);
      const r = compile(
        Object.keys(files).map((f) => path.join(root, f)),
        { platforms: ["android"], sdk: { android: { jars: fake!.bind, classpath } } },
      );

      expect(r.diagnostics).toEqual([]);
      expect(r.files.get("android/lucent_bindings.cpp")).toContain(
        'auto a1 = Convert<lucent::Bytes>::borrow(rt, arg(args, count, 1), Path{"set", "argument \'value\'"});',
      );
    },
    300_000,
  );
});
