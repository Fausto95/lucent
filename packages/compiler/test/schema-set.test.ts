import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const KIT = {
  module: "Kit",
  header: "Kit/Kit.h",
  types: [
    {
      kind: "class",
      name: "KITThing",
      native: "KITThing",
      constructors: [{ params: [], selector: "init" }],
      methods: [{ name: "label", params: [], returns: "string", selector: "label" }],
    },
  ],
};

describe("iOS code typed from an exported schema set", () => {
  it("type-checks and generates iOS code where Xcode is not installed", () => {
    const p = setProgram(
      `import { KITThing } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  return new KITThing().label();
}
`,
      schemaSet([KIT]),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toContain("[KITThing alloc]");
    expect(p.mm).toContain("label]");
  });

  it("reports a module the set does not have, with the fix", () => {
    const p = setProgram(
      `import { KITOther } from "lucent:ios/Other";
export async function run(): Promise<string> {
  return \`\${KITOther}\`;
}
`,
      schemaSet([KIT]),
    );

    expect(p.r.diagnostics).toMatchObject([
      {
        code: "LUCENT3004",
        message: expect.stringMatching(/lucent:ios\/Other is not in the exported schemas/),
        fix: expect.stringMatching(/lucent sdk lock --schemas/),
      },
    ]);
  });
});
