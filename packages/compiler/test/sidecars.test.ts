import { describe, expect, test } from "vite-plus/test";
import { compile, sidecarSymbol } from "../src/index.ts";
import { generateSwift } from "@lucent-lang/backend-swift";
import { generateKotlin } from "@lucent-lang/backend-kotlin";

/**
 * A `@Native` declaration is implemented by a `.swift`/`.kt` file beside its
 * Lucent source instead of by a package manifest. The compiler only needs the
 * signature: it emits a call to the sidecar symbol and lets the native
 * toolchain check that the implementation matches.
 */
const d = "// @ts-expect-error Lucent function decorator; compiled before TypeScript.";

const build = (source: string) => {
  const result = compile(source, { fileName: "toolkit.lucent.ts" });
  if (!result.module) throw new Error(result.diagnostics.map((x) => `${x.code}: ${x.message}`).join("\n"));
  return result.module;
};

const failure = (source: string) => compile(source, { fileName: "toolkit.lucent.ts" }).diagnostics.map((x) => x.code);

describe("@Native declarations", () => {
  test("calls the prefixed sidecar symbol, labelled in Swift and positional in Kotlin", () => {
    const module = build(`${d}\n@Native\nexport declare function join(a: string, b: string): string;`);
    expect(generateSwift(module).code).toContain("return try lucentNative_join(a: a, b: b)");
    expect(generateKotlin(module).code).toContain("return lucentNative_join(a, b)");
  });

  test("the prefix keeps a root-module declaration from calling its own wrapper", () => {
    const module = build(`${d}\n@Native\nexport declare function sha256(bytes: Uint8Array): string;`);
    const swift = generateSwift(module).code;
    expect(swift).toContain("func sha256(");
    expect(swift).toContain(`return try ${sidecarSymbol("sha256")}(bytes: bytes)`);
  });

  test("awaits a promise-returning declaration", () => {
    const module = build(`${d}\n@Native\nexport declare function load(path: string): Promise<Uint8Array>;`);
    expect(generateSwift(module).code).toContain("return try await lucentNative_load(path: path)");
    expect(generateKotlin(module).code).toContain("suspend fun load(");
  });

  test("omits the return for a void declaration", () => {
    const module = build(`${d}\n@Native\nexport declare function ping(): void;`);
    expect(generateSwift(module).code).toContain("try lucentNative_ping()");
    expect(generateSwift(module).code).not.toContain("return try lucentNative_ping()");
  });

  test("an undecorated declaration still requires a binding", () => {
    expect(failure("export declare function orphan(): string;")).toContain("LUCENT1011");
  });

  test("@Native takes no arguments", () => {
    expect(failure(`${d}\n@Native()\nexport declare function x(): string;`)).toContain("LUCENT1001");
  });
});

describe("@Capability", () => {
  test("reaches module capabilities, which the build checks against app config", () => {
    const module = build(
      `${d}\n@Capability("crypto")\n${d}\n@Native\nexport declare function hash(b: Uint8Array): string;\n` +
        `export function use(b: Uint8Array): string { return hash(b); }`,
    );
    expect(module.capabilities).toEqual(["crypto"]);
  });

  test("accepts several names", () => {
    const module = build(
      `${d}\n@Capability("filesystem", "device")\n${d}\n@Native\nexport declare function read(): Promise<string>;\n` +
        `export async function use(): Promise<string> { return await read(); }`,
    );
    expect(module.capabilities).toEqual(["device", "filesystem"]);
  });

  test("an exported declaration counts even with no Lucent caller", () => {
    // Exporting it puts it on the module's JavaScript surface, so the app
    // still has to declare the capability it needs.
    const module = build(`${d}\n@Capability("crypto")\n${d}\n@Native\nexport declare function hash(): string;`);
    expect(module.capabilities).toEqual(["crypto"]);
  });

  test("rejects a non-literal capability name", () => {
    expect(failure(`${d}\n@Capability(name)\n${d}\n@Native\nexport declare function x(): string;`)).toContain(
      "LUCENT1001",
    );
  });

  test("rejects an empty capability list", () => {
    expect(failure(`${d}\n@Capability()\n${d}\n@Native\nexport declare function x(): string;`)).toContain("LUCENT1001");
  });
});
