/**
 * Swift shapes bound by rule (TA33): tuples cross as TypeScript tuples,
 * their labels kept as the elements' names; closures as Lucent functions,
 * both ways, through Objective-C blocks.
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

const meters: SwiftFixture = {
  name: "Meters",
  source: path.join(here, "fixtures/swift-shapes/Meters.swift"),
};

const program = (body: string) =>
  iosProgram(
    `import { Meter } from "lucent:ios/Meters";
export async function run(): Promise<string> {
  const meter = new Meter();
${body}
}
`,
    [meters],
  );

describe.skipIf(!xcode)("Swift shapes", () => {
  beforeAll(() => prepareSwiftModules([meters]), 300_000);

  it("passes and returns tuples as TypeScript tuples, labeled ones by position", () => {
    const p = program(`  const [low, high] = meter.range();
  const bounds = meter.bounds();
  const [text, on] = meter.state();
  return \`\${low} \${high} \${meter.span([2, 7])} \${bounds[0]} \${bounds[1]} \${text} \${on}\`;`);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "1 3 5 -1 9 on true\n" });
  }, 600_000);

  it("passes Lucent functions as Swift closures, and calls the closures Swift returns", () => {
    const p = program(`  const add = meter.adder(1);
  const seen: number[] = [];
  meter.each([1, 2], (v) => {
    seen.push(v);
  });
  const greeted = meter.greet("ada", (n) => n.toUpperCase());
  let heard = "";
  meter.announce((s) => {
    heard = s;
  });
  return \`\${add(2)} \${meter.apply((x) => x * 3)} \${seen.join(",")} \${greeted} \${heard}\`;`);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "3 6 1,2 ADA ready\n" });
  }, 600_000);
});
