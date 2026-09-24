import { describe, expect, it } from "vitest";
import { withLucentPaths } from "../src/cli/tsconfig.ts";

const entry = '"lucent:*": ["./.lucent/native/types/*"]';

describe("withLucentPaths", () => {
  it("adds paths to compilerOptions", () => {
    const text = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n';
    expect(withLucentPaths(text)).toBe(`{\n  "compilerOptions": {\n    "strict": true,\n    "paths": { ${entry} }\n  }\n}\n`);
  });

  it("adds the entry to existing paths, keeping comments and trailing commas", () => {
    const text = '{\n  // the app\'s aliases\n  "compilerOptions": {\n    "paths": {\n      "@/*": ["./src/*"],\n    },\n  },\n}\n';
    expect(withLucentPaths(text)).toBe(`{\n  // the app's aliases\n  "compilerOptions": {\n    "paths": {\n      "@/*": ["./src/*"],\n      ${entry},\n    },\n  },\n}\n`);
  });

  it("adds compilerOptions when there are none", () => {
    expect(withLucentPaths('{ "extends": "expo/tsconfig.base" }')).toBe(`{ "extends": "expo/tsconfig.base", "compilerOptions": { "paths": { ${entry} } } }`);
  });

  it("fills empty objects", () => {
    expect(withLucentPaths('{ "compilerOptions": { "paths": {} } }')).toBe(`{ "compilerOptions": { "paths": { ${entry} } } }`);
    expect(withLucentPaths("{}")).toBe(`{ "compilerOptions": { "paths": { ${entry} } } }`);
  });

  it("leaves a config that maps lucent:* alone", () => {
    expect(withLucentPaths(`{ "compilerOptions": { "paths": { "lucent:*": ["./types/*"] } } }`)).toBeUndefined();
  });

  it("throws on a config it cannot read", () => {
    expect(() => withLucentPaths("{ compilerOptions: ")).toThrow(/tsconfig\.json/);
  });
});
