import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  xcode,
} from "./swift-harness.ts";

const codes = (p: ReturnType<typeof iosProgram>) => p.r.diagnostics.map((d) => d.code);

/** A UIKit class newer than the apps' oldest iOS (15.1). */
const calendar = (body: string) => `import { UICalendarView } from "lucent:ios/UIKit";
import { available } from "lucent:ios";
import { main } from "lucent:thread";
export function run(): Promise<string> {
  return main(() => {
${body}
  });
}
`;

describe.skipIf(!xcode)("iOS availability", () => {
  beforeAll(() => prepareSwiftModules(["Orbit"]), 300_000);

  it("refuses Objective-C APIs newer than iOS 15.1 used without a check", () => {
    const p = iosProgram(calendar(`    return \`\${new UICalendarView() !== null}\`;`));

    expect(p.r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT3007",
        'UICalendarView needs iOS 16.0 (apps run from iOS 15.1): use it under if (available("ios", 16))',
      ],
    ]);
  });

  it(
    "accepts them under a check of the running OS, in its usual forms",
    { timeout: 300_000 },
    () => {
      const guarded = [
        `    if (available("ios", 16)) return \`\${new UICalendarView() !== null}\`;
    return "old";`,
        `    if (!available("ios", 16, 2)) return "old";
    return \`\${new UICalendarView() !== null}\`;`,
        `    return available("ios", 17) ? \`\${new UICalendarView() !== null}\` : "old";`,
        `    return \`\${available("ios", 16) && new UICalendarView() !== null}\`;`,
      ];

      for (const body of guarded) expect(codes(iosProgram(calendar(body)))).toEqual([]);
      // Too old a check is no check.
      expect(
        codes(
          iosProgram(
            calendar(`    if (available("ios", 15)) return \`\${new UICalendarView() !== null}\`;
    return "old";`),
          ),
        ),
      ).toEqual(["LUCENT3007"]);
    },
  );

  it("compiles the glue of a checked call without availability warnings", () => {
    const p = iosProgram(
      calendar(`    if (available("ios", 16)) return \`\${new UICalendarView() !== null}\`;
    return "old";`),
    );

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
  }, 300_000);

  it("refuses Swift members newer than iOS 15.1 used without a check", () => {
    const p = iosProgram(
      `import { SearchClient } from "lucent:ios/Orbit";
export async function run(): Promise<string> {
  return new SearchClient().recent().join(" ");
}
`,
      ["Orbit"],
    );

    expect(p.r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT3007",
        'SearchClient.recent needs iOS 17.0 (apps run from iOS 15.1): use it under if (available("ios", 17))',
      ],
    ]);
  });

  it("needs iOS 16 to pass a protocol value whose associated types an argument names", () => {
    const p = iosProgram(
      `import { Stores, type Store } from "lucent:ios/Orbit";
class Names implements Store<string> {
  load(): string | null {
    return null;
  }

  save(item: string): boolean {
    return item !== "";
  }
}
export async function run(): Promise<string> {
  return Stores.swap(new Names(), "a");
}
`,
      ["Orbit"],
    );

    expect(p.r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT3007",
        'Stores.swap needs iOS 16.0 (apps run from iOS 15.1): use it under if (available("ios", 16))',
      ],
    ]);
  });

  it("marks the shims of checked Swift members available where they are", () => {
    const p = iosProgram(
      `import { SearchClient } from "lucent:ios/Orbit";
import { available } from "lucent:ios";
export async function run(): Promise<string> {
  if (!available("ios", 17)) return "old";
  return new SearchClient().recent().join(" ");
}
`,
      ["Orbit"],
    );

    expect(p.r.diagnostics).toEqual([]);
    expect(p.shims).toContain("@available(iOS 17.0, *)");
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "orbit\n" });
  }, 600_000);
});
