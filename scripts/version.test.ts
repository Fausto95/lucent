import { describe, expect, it } from "vitest";
import { bumpVersion, replaceVersion } from "./version.ts";

describe("bumpVersion", () => {
  it("increments the requested part and resets the lower ones", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("rejects anything that is not a plain x.y.z version", () => {
    expect(() => bumpVersion("1.2.3-beta.1", "patch")).toThrow(/1\.2\.3-beta\.1/);
    expect(() => bumpVersion("1.2", "patch")).toThrow();
    expect(() => bumpVersion("v1.2.3", "patch")).toThrow();
  });
});

describe("replaceVersion", () => {
  const text = '{\n  "name": "@lucent-lang/cli",\n  "version": "0.0.1",\n  "engines": { "node": ">=22.12" }\n}\n';

  it("rewrites only the version line and keeps formatting intact", () => {
    expect(replaceVersion(text, "0.0.1", "0.0.2")).toBe(
      '{\n  "name": "@lucent-lang/cli",\n  "version": "0.0.2",\n  "engines": { "node": ">=22.12" }\n}\n',
    );
  });

  it("throws when the expected version line is absent", () => {
    expect(() => replaceVersion(text, "9.9.9", "0.0.2")).toThrow(/9\.9\.9/);
  });
});
