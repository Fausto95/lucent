/** Availability of iOS C globals and enum cases, typed from a schema set (no Xcode needed). */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "Kit",
      header: "Kit/Kit.h",
      types: [
        {
          kind: "enum",
          name: "KITMode",
          native: "KITMode",
          cases: [
            { name: "plain", native: "KITModePlain", value: 0 },
            { name: "vivid", native: "KITModeVivid", value: 1, since: "17.0" },
          ],
        },
        {
          kind: "class",
          name: "KITKey",
          native: "KITKey",
          properties: [
            { name: "old", static: true, readonly: true, type: "string", global: "KITKeyOld" },
            {
              name: "fresh",
              static: true,
              readonly: true,
              type: "string",
              global: "KITKeyFresh",
              since: "17.0",
            },
          ],
        },
      ],
      functions: [{ name: "KITNow", params: [], returns: "double", since: "17.0" }],
      constants: [{ name: "KITLimit", type: "double", since: "17.0" }],
    },
  ]);

const run = (body: string) =>
  setProgram(
    `import { KITKey, KITLimit, KITMode, KITNow } from "lucent:ios/Kit";
import { available } from "lucent:ios";
export async function run(): Promise<string> {
${body}
}
`,
    set(),
  );

describe("iOS globals newer than the oldest iOS", () => {
  it("need an availability check: C functions, constants, typed string keys and enum cases", () => {
    const uses = {
      "KITNow()": "KITNow",
      KITLimit: "KITLimit",
      "KITKey.fresh": "KITKey.fresh",
      "KITMode.vivid": "KITMode.vivid",
    };
    for (const [use, what] of Object.entries(uses))
      expect(run(`  return \`\${${use}}\`;`).messages).toEqual([
        [
          "LUCENT3007",
          `${what} needs iOS 17.0 (apps run from iOS 15.1): use it under if (available("ios", 17))`,
        ],
      ]);
    expect(run("  return `${KITKey.old} ${KITMode.plain}`;").messages).toEqual([]);
  });

  it("are used under a check", () => {
    const p = run(
      '  if (!available("ios", 17)) return "old";\n  return `${KITNow()} ${KITLimit} ${KITKey.fresh} ${KITMode.vivid}`;',
    );

    expect(p.messages).toEqual([]);
  });
});
