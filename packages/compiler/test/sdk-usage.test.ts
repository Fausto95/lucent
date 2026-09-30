import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable, symbolKey } from "@lucent-lang/bindgen";
import { compile, type SdkOptions } from "../src/index.ts";

const xcode = process.platform === "darwin" && sdkAvailable("ios");
const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bindgen/test/fixtures/objc",
);
const abiModule = path.join(fixtures, "Abi");
/** A platform module whose `platform` side is `src` (exporting run()), compiled for that platform. */
function program(platform: "ios" | "android", src: string, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-usage-"));
  const other = platform === "ios" ? "android" : "ios";
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    [`m.${platform}.lucent.ts`]: src,
    [`m.${other}.lucent.ts`]: 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: [platform], sdk },
  );
}

describe.skipIf(!xcode)("the SDK symbols a compile uses", () => {
  const abi = (src: string) => program("ios", src, { ios: { includePaths: [abiModule] } });

  it("lists each member once with every role it is used in, and the types they name", () => {
    const r = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  const thing = new ABIThing();
  thing.identifier = 2n ** 40n;
  return \`\${thing.identifier} \${thing.countOfItems()} \${thing.point(3n).y}\`;
}
`);

    expect(r.diagnostics).toEqual([]);

    const uses = r.sdkUses!;
    const of = (name: string) => uses.filter((u) => u.name === name);

    expect(of("identifier")).toEqual([
      expect.objectContaining({
        platform: "ios",
        module: "Abi",
        owner: "ABIThing",
        kind: "property",
        symbol: "objc:c:objc(cs)ABIThing(py)identifier",
        roles: ["get", "set"],
      }),
    ]);
    expect(of("constructor")).toEqual([
      expect.objectContaining({ owner: "ABIThing", kind: "constructor", roles: ["new"] }),
    ]);
    expect(of("countOfItems")).toEqual([
      expect.objectContaining({ kind: "method", roles: ["call"] }),
    ]);

    // The types of the module the used members name: the owner and a result.
    expect(uses.filter((u) => u.kind === "type").map((u) => u.name)).toEqual([
      "ABIPoint",
      "ABIThing",
    ]);

    // Sorted by key: the same program lists them in the same order.
    expect(uses.map(symbolKey)).toEqual(uses.map(symbolKey).sort());
  });

  it("lists a member called as a promise as the SDK declares it", () => {
    const r = program(
      "ios",
      `import { WDGLoader } from "lucent:ios/Widgets";
export async function run(): Promise<string> {
  const data = await new WDGLoader().load();
  return \`\${data.length}\`;
}
`,
      { ios: { includePaths: [path.join(fixtures, "Widgets")] } },
    );

    expect(r.diagnostics).toEqual([]);
    expect(r.sdkUses!.filter((u) => u.name === "load")).toEqual([
      expect.objectContaining({
        owner: "WDGLoader",
        signature: "(@escaping (NSData?, error?) => void) => void",
        roles: ["call"],
      }),
    ]);
  });

  it("lists nothing for a program that does not compile", () => {
    const r = abi(`import { ABIThing } from "lucent:ios/Abi";
export async function run(): Promise<string> {
  return \`\${new ABIThing().grid().length}\`;
}
`);

    expect(r.ok).toBe(false);
    expect(r.sdkUses).toBeUndefined();
  });
});

describe.skipIf(!sdkAvailable("android"))("the Android SDK symbols a compile uses", () => {
  it("names each member by its JVM symbol", () => {
    const r = program(
      "android",
      `import { SystemClock } from "lucent:android/android.os";
export async function run(): Promise<string> {
  SystemClock.sleep(1n);
  return \`\${SystemClock.elapsedRealtime()}\`;
}
`,
    );

    expect(r.diagnostics).toEqual([]);
    expect(r.sdkUses!.filter((u) => u.kind !== "type")).toEqual([
      expect.objectContaining({
        module: "android.os",
        owner: "SystemClock",
        name: "elapsedRealtime",
        static: true,
        symbol: "jvm:android/os/SystemClock#elapsedRealtime()J",
        roles: ["call"],
      }),
      expect.objectContaining({
        name: "sleep",
        symbol: "jvm:android/os/SystemClock#sleep(J)V",
        signature: "(long) => void",
      }),
    ]);
  });
});
