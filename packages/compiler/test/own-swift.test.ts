/**
 * A Lucent package's own Swift (ios.nativeSources), bound as
 * `lucent:ios/LucentNative`: the shims calling it are compiled into the
 * same module, so they do not import it, and nothing is linked for it.
 * Typed from a schema set, on any machine.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "LucentNative",
      frameworks: [],
      provenance: {
        artifact: "swift-module:LucentNative",
        kind: "swift-module",
        target: "arm64-apple-ios15.1-simulator",
        extractor: "00000000",
      },
      types: [
        {
          kind: "class",
          name: "Wrapper",
          native: "LucentNative.Wrapper",
          swift: { kind: "class" },
          constructors: [{ params: [], swift: { name: "init()" } }],
          methods: [{ name: "level", params: [], returns: "double", swift: { name: "level()" } }],
        },
      ],
    },
  ]);

describe("a package's own Swift", () => {
  it("is called through shims in its own module, without importing or linking it", () => {
    const p = setProgram(
      `import { Wrapper } from "lucent:ios/LucentNative";\nexport async function run(): Promise<string> {\n  return String(new Wrapper().level());\n}\n`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("Wrapper()");
    expect(p.shims).not.toMatch(/^import LucentNative$/m);
    expect(p.r.frameworks ?? []).not.toContain("LucentNative");
    expect(p.r.pods ?? []).toEqual([]);
  });
});
