/**
 * Swift initializers whose TypeScript signatures are the same (only their
 * labels differ): none is bound silently in place of another. Each is a
 * static factory named after its labels, and `new` takes only those that
 * stand apart.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  type SwiftFixture,
  xcode,
} from "./swift-harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const vaults: SwiftFixture = {
  name: "Vaults",
  source: path.join(here, "fixtures/swift-overloads/Vaults.swift"),
};

const program = (body: string) =>
  iosProgram(
    `import { Vault } from "lucent:ios/Vaults";
export async function run(): Promise<string> {
${body}
}
`,
    [vaults],
  );

describe.skipIf(!xcode)("Swift initializers TypeScript cannot tell apart", () => {
  beforeAll(() => prepareSwiftModules([vaults]), 300_000);

  it("are each a static factory named after their labels, and run as the initializer they name", () => {
    const p = program(
      '  return `${Vault.withService("s").service} ${Vault.withAccessGroup("g").accessGroup} ${new Vault().service}`;',
    );

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "s g default\n" });
  }, 600_000);

  it("are not what `new` with their arguments binds, which would pick one: the error names them", () => {
    expect(program('  return new Vault("s").service;').r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LUCENT9001",
        message: expect.stringContaining(
          "Vault's initializers that take the same types are its static factories, which TypeScript tells apart: Vault.withAccessGroup(…) for init(accessGroup:), Vault.withService(…) for init(service:).",
        ),
        fix: "call the one you mean: Vault.withAccessGroup(…)",
      }),
    ]);
  }, 600_000);
});
