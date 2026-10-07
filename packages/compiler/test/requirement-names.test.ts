/** LUCENT3013: methods named like a protocol requirement that match none. */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "Loc",
      header: "Loc/Loc.h",
      types: [
        {
          kind: "class",
          name: "LOCManager",
          native: "LOCManager",
          constructors: [{ params: [], selector: "init" }],
        },
        {
          kind: "class",
          name: "LOCManagerDelegate",
          native: "LOCManagerDelegate",
          interface: true,
          methods: [
            {
              name: "locationManager_didFailWithError",
              selector: "locationManager:didFailWithError:",
              params: [
                { name: "manager", type: "Loc.LOCManager" },
                { name: "error", type: "error" },
              ],
              returns: "void",
              optional: true,
            },
            {
              name: "locationManagerDidPause",
              selector: "locationManagerDidPause:",
              params: [{ name: "manager", type: "Loc.LOCManager" }],
              returns: "void",
              optional: true,
            },
          ],
        },
      ],
    },
  ]);

const program = (members: string) =>
  setProgram(
    `import { LOCManager, type LOCManagerDelegate } from "lucent:ios/Loc";
class Updates implements LOCManagerDelegate {
${members}
}
export async function run(): Promise<string> {
  return \`\${new Updates() !== null}\`;
}
`,
    set(),
  );

const warnings = (p: ReturnType<typeof program>) =>
  (p.r.warnings ?? []).map((w) => [w.code, w.message]);

describe("methods named like a requirement", () => {
  it("warn when they match none, naming the one meant", () => {
    // One right (TypeScript refuses a class with nothing in common with a weak type), two typos.
    const p = program(`  locationManager_didFailWithError(manager: LOCManager, error: Error): void {}
  locationManager_didFailWithErorr(manager: LOCManager, error: Error): void {}
  locationManagerDidPuase(manager: LOCManager): void {}`);

    expect(p.messages).toEqual([]);
    expect(warnings(p)).toEqual([
      [
        "LUCENT3013",
        "Updates.locationManager_didFailWithErorr matches no requirement of LOCManagerDelegate, so the platform never calls it: did you mean locationManager_didFailWithError?",
      ],
      [
        "LUCENT3013",
        "Updates.locationManagerDidPuase matches no requirement of LOCManagerDelegate, so the platform never calls it: did you mean locationManagerDidPause?",
      ],
    ]);
  });

  it("leave requirements, private helpers and methods unlike any alone", () => {
    const p = program(`  locationManager_didFailWithError(manager: LOCManager, error: Error): void {
    this.log(error.message);
  }
  private locationManager_helper(): void {}
  log(message: string): void {}
  summary(): string {
    return "";
  }`);

    expect(p.messages).toEqual([]);
    expect(warnings(p)).toEqual([]);
  });
});
