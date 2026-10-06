import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { compile, runtimeDir, type SdkOptions } from "../src/index.ts";

const xcode = process.platform === "darwin" && sdkAvailable("ios");
const abiModule = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bindgen/test/fixtures/objc/Abi",
);

/** A platform module whose `platform` side is `src` (exporting run()), compiled for that platform. */
function program(platform: "ios" | "android", src: string, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plans-"));
  const other = platform === "ios" ? "android" : "ios";
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    [`m.${platform}.lucent.ts`]: src,
    [`m.${other}.lucent.ts`]: 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: [platform], sdk },
  );
  const unit = platform === "ios" ? "ios/m_m.mm" : "android/m_m.cpp";
  return { r, dir, code: r.files.get(unit) ?? "" };
}

/** Against the Abi fixture module. */
const abi = (src: string) =>
  // The shared SDK cache, as an app's builds use it: the fixture is cached by its content.
  program("ios", src, { ios: { includePaths: [abiModule] } });

const messages = (r: { diagnostics: { code: string; message: string }[] }) =>
  r.diagnostics.map((d) => [d.code, d.message]);

const exact = `import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  const thing = new ABIThing();
  thing.identifier = 2n ** 40n;
  return \`\${thing.identifier} \${thing.countOfItems()} \${thing.point(3n).y}\`;
}
`;

describe.skipIf(!xcode)("binding plans decide iOS uses", () => {
  it("refuses a use with the plan's reason and the declaration it comes from", () => {
    const { r } = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  return \`\${new ABIThing().grid().length}\`;
}
`);

    expect(messages(r)).toEqual([
      [
        "LUCENT2002",
        "ABIThing.grid: nested collections from Objective-C are not supported yet (objc:c:objc(cs)ABIThing(im)grid in clang-module:Abi)",
      ],
    ]);
  }, 180_000);

  it("passes what the plan accepts, and refuses errors passed in", () => {
    const fill = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  new ABIThing().fill([["a", "b"], ["c"]]);
  return "";
}
`);
    const report = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  new ABIThing().report(new Error("x"));
  return "";
}
`);

    expect(messages(fill.r)).toEqual([]);
    expect(messages(report.r)).toEqual([
      [
        "LUCENT2002",
        "ABIThing.report: passing errors to Objective-C is not supported yet (objc:c:objc(cs)ABIThing(im)report: in clang-module:Abi)",
      ],
    ]);
  });

  it("assigns functions to block properties, as blocks", () => {
    const { r, code } = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  let seen = 0n;
  const thing = new ABIThing();
  thing.onChange = (count) => {
    seen = count;
  };
  thing.onChange = null;
  return \`\${seen}\`;
}
`);

    expect(messages(r)).toEqual([]);
    expect(code).toContain("setOnChange:");
    expect(code).toContain("lucent::objc::block");
  });

  it("refuses a requirement's pointer only to Lucent methods that take it", () => {
    const takes =
      abi(`import { ABIThing, type ABIMeterDelegate, type ABIPoint } from "lucent:ios/Abi";
import type { Out } from "lucent:ios";
class Meter implements ABIMeterDelegate {
  meter_didMeasure(meter: ABIThing, point: Out<ABIPoint>): void {}
}
export async function run(): Promise<string> {
  new ABIThing().delegate = new Meter();
  return "";
}
`);
    const leaves = abi(`import { ABIThing, type ABIMeterDelegate } from "lucent:ios/Abi";
class Meter implements ABIMeterDelegate {
  measured = 0;
  meter_didMeasure(meter: ABIThing): void {
    this.measured++;
  }
}
export async function run(): Promise<string> {
  new ABIThing().delegate = new Meter();
  return "";
}
`);

    expect(messages(takes.r)).toEqual([
      [
        "LUCENT2002",
        "ABIMeterDelegate.meter_didMeasure: a block or requirement that takes a pointer must run while the platform waits for it (objc:c:objc(pl)ABIMeterDelegate(im)meter:didMeasure: in clang-module:Abi)",
      ],
    ]);
    expect(messages(leaves.r)).toEqual([]);
  });

  it("takes 0 for an option set's empty value, and its cases combined", () => {
    const { r, code } = abi(`import { ABIEdges, ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  const thing = new ABIThing();
  thing.edges = 0;
  thing.insetEdges(0);
  thing.insetEdges(ABIEdges.top | ABIEdges.bottom);
  // A variable of the set's type says it can be empty.
  const none: ABIEdges | 0 = 0;
  thing.edges = none;
  return \`\${thing.edges}\`;
}
`);

    expect(messages(r)).toEqual([]);
    expect(code).toContain("lucent::toNativeNumber<ABIEdges>(0.0)");
  });

  it("passes an object of a protocol composed with NSObjectProtocol, as the protocol", () => {
    const { r, code } = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  const thing = new ABIThing();
  thing.place(thing);
  return "";
}
`);

    expect(messages(r)).toEqual([]);
    expect(code).toContain(" place:");
  });

  it("passes native 64-bit integers as bigints, exactly or RangeError naming the value", () => {
    const { r, code } = abi(exact);

    expect(messages(r)).toEqual([]);
    expect(code).toContain("lucent::BigInt{[");
    expect(code).toContain('lucent::toNativeInteger<int64_t>(v_, "ABIThing.identifier")');
    expect(code).toMatch(/lucent::toNativeInteger<NSInteger>\(.*"index of ABIThing\.point"\)/);
    expect(code).not.toContain("lucent::exactNumber(");
  });

  it("refuses a number where a native 64-bit integer is a bigint", () => {
    const { r } = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  new ABIThing().identifier = 1;
  return "";
}
`);

    expect(messages(r)).toEqual([
      [
        expect.any(String),
        expect.stringContaining("Type 'number' is not assignable to type 'bigint'"),
      ],
    ]);
  });

  it("reads and writes a 64-bit integer pointer through an Out of bigint", () => {
    const { r, code } = abi(`import { ABIThing } from "lucent:ios/Abi";
import { Out } from "lucent:ios";
export async function run(): Promise<string> {
  const count = new Out<bigint>();
  count.value = 1n;
  new ABIThing().readCount(count);
  return \`\${count.value}\`;
}
`);

    expect(messages(r)).toEqual([]);
    expect(code).toContain("lucent::objc::NumberOut<NSInteger>");
    expect(code).toContain("lucent::objc::outBigInt(");
  });

  it("generates glue that compiles against the fixture's header", () => {
    const { r, dir } = abi(`import { ABIThing } from "lucent:ios/Abi";
import { Out } from "lucent:ios";
export async function run(): Promise<string> {
  const thing = new ABIThing();
  thing.onChange = (count) => {};
  thing.fill([["a"]]);
  thing.identifier = thing.identifier + 1n;
  thing.place(thing);
  const count = new Out<bigint>();
  count.value = 1n;
  thing.readCount(count);
  return \`\${thing.countOfItems()} \${thing.point(2n).x} \${count.value}\`;
}
`);
    expect(messages(r)).toEqual([]);

    for (const [k, v] of r.files) {
      fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
      fs.writeFileSync(path.join(dir, "out", k), v);
    }
    const clang = spawnSync(
      "xcrun",
      [
        "--sdk",
        "iphonesimulator",
        "clang++",
        "-std=c++20",
        "-fobjc-arc",
        "-fsyntax-only",
        "-target",
        "arm64-apple-ios15.1-simulator",
        "-Werror",
        "-Wno-gnu-statement-expression",
        "-Wno-unused-label",
        "-Wno-parentheses-equality",
        "-Wno-comma",
        `-I${path.join(runtimeDir(), "cpp")}`,
        `-I${path.join(dir, "out/ios")}`,
        `-I${abiModule}`,
        "-x",
        "objective-c++",
        path.join(dir, "out/ios/m_m.mm"),
      ],
      { encoding: "utf8" },
    );

    expect(clang.stderr).toBe("");
  }, 120_000);
});

describe.skipIf(!sdkAvailable("android"))("binding plans decide Android uses", () => {
  it("passes Java longs as bigints, exactly or RangeError naming the value", () => {
    const { r, code } = program(
      "android",
      `import { SystemClock } from "lucent:android/android.os";
export async function run(): Promise<string> {
  SystemClock.sleep(1n);
  return \`\${SystemClock.elapsedRealtime()}\`;
}
`,
    );

    expect(messages(r)).toEqual([]);
    expect(code).toContain("lucent::BigInt{");
    expect(code).toMatch(/lucent::toNativeInteger<jlong>\(.*"arg0 of SystemClock\.sleep"\)/);
    expect(code).not.toContain("lucent::exactNumber(");
  });

  it("inlines a Java long constant as its exact bigint", () => {
    const { r, code } = program(
      "android",
      `import { Long } from "lucent:android/java.lang";
export async function run(): Promise<string> {
  return \`\${Long.MAX_VALUE}\`;
}
`,
    );

    expect(messages(r)).toEqual([]);
    expect(code).toContain("9223372036854775807");
  });

  it("refuses writing a Java field with the rule's reason and the field it comes from", () => {
    const { r } = program(
      "android",
      `import { Rect } from "lucent:android/android.graphics";
export async function run(): Promise<string> {
  const rect = new Rect();
  rect.left = 1;
  return "";
}
`,
    );

    expect(messages(r)).toEqual([
      [
        "LUCENT1008",
        expect.stringMatching(
          /^Rect\.left: assigning Java fields is not supported yet \(jvm:android\/graphics\/Rect#left:I in android-sdk:[\w.]+\)$/,
        ),
      ],
    ]);
  });
});
