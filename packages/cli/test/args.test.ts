import { describe, expect, test } from "vite-plus/test";
import { parseCommandArgs, suggest, type OptionSpecs } from "../src/args.ts";
import { CliError } from "../src/errors.ts";

const specs = {
  host: { type: "string", description: "Target host", values: ["expo", "nitro"], placeholder: "<host>" },
  out: { type: "string", description: "Output directory", placeholder: "<dir>" },
  postgen: { type: "boolean", description: "Run nitrogen", default: true },
  force: { type: "boolean", short: "f", description: "Recompile everything" },
} as const satisfies OptionSpecs;

describe("parseCommandArgs", () => {
  test("reads strings, booleans, negations and positionals", () => {
    const parsed = parseCommandArgs(specs, ["--host", "nitro", "--no-postgen", "-f", "a.lucent.ts", "b.lucent.ts"]);
    expect(parsed.values).toEqual({ host: "nitro", postgen: false, force: true });
    expect(parsed.positionals).toEqual(["a.lucent.ts", "b.lucent.ts"]);
  });

  test("applies defaults", () => {
    expect(parseCommandArgs(specs, []).values).toEqual({ postgen: true });
  });

  test("rejects values outside the allowed list", () => {
    expect(() => parseCommandArgs(specs, ["--host", "web"])).toThrow(CliError);
    expect(() => parseCommandArgs(specs, ["--host", "web"])).toThrow(/expo, nitro/);
  });

  test("rejects unknown options and suggests the closest one", () => {
    expect(() => parseCommandArgs(specs, ["--hots", "expo"])).toThrow(/Unknown option --hots/);
    try {
      parseCommandArgs(specs, ["--hots", "expo"]);
    } catch (error) {
      expect((error as CliError).hint).toContain("--host");
    }
  });

  test("rejects a missing value", () => {
    expect(() => parseCommandArgs(specs, ["--out"])).toThrow(/--out/);
  });
});

describe("suggest", () => {
  test("finds a close command name", () => {
    expect(suggest("buidl", ["build", "check", "init"])).toBe("build");
    expect(suggest("chek", ["build", "check", "init"])).toBe("check");
    expect(suggest("doc", ["build", "doctor"])).toBe("doctor");
  });
  test("gives up on distant input", () => {
    expect(suggest("zzzzzz", ["build", "check"])).toBeUndefined();
  });
});
