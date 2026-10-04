import { describe, expect, it } from "vite-plus/test";
import { knownLimitations, parseChangelog } from "../../../scripts/website/releases.ts";

const CHANGELOG = `# @lucent-lang/lucent

## 0.1.2

### Patch Changes

- [#63](https://github.com/Fausto95/lucent/pull/63) [\`e160e7a\`](https://github.com/Fausto95/lucent/commit/e160e7a) Thanks [@Fausto95](https://github.com/Fausto95)! - Build again where one platform's SDK is missing.

- [#60](https://github.com/Fausto95/lucent/pull/60) [\`820fe5f\`](https://github.com/Fausto95/lucent/commit/820fe5f) Thanks [@Fausto95](https://github.com/Fausto95)! - Make \`for … of\` faster.

## 0.1.0

### Minor Changes

- [#13](https://github.com/Fausto95/lucent/pull/13) [\`9031f4e\`](https://github.com/Fausto95/lucent/commit/9031f4e) Thanks [@Fausto95](https://github.com/Fausto95)! - Support \`bigint\`.

### Patch Changes

- Fix the loader.
`;

const ROADMAP = `## Status at a glance

- ✅ Things.

## Known limitations and deferred checks

### Deferred checks (need the maintainer)

- **Physical devices.** Not run.

### Views

- Views are behind the internal \`LUCENT_VIEWS=fabric\` switch, off by
  default.
- Native views' JSX has fixed children ([T49](#t49)'s).

### Language, runtime and bindings

- Weak references are missing.

## Design slices and tasks
`;

describe("parseChangelog", () => {
  it("reads each release's kinds of change and their entries, newest first", () => {
    expect(parseChangelog(CHANGELOG)).toEqual([
      {
        version: "0.1.2",
        changes: [
          {
            kind: "Patch Changes",
            entries: [
              "Build again where one platform's SDK is missing. ([#63](https://github.com/Fausto95/lucent/pull/63))",
              "Make `for … of` faster. ([#60](https://github.com/Fausto95/lucent/pull/60))",
            ],
          },
        ],
      },
      {
        version: "0.1.0",
        changes: [
          {
            kind: "Minor Changes",
            entries: ["Support `bigint`. ([#13](https://github.com/Fausto95/lucent/pull/13))"],
          },
          { kind: "Patch Changes", entries: ["Fix the loader."] },
        ],
      },
    ]);
  });
});

describe("knownLimitations", () => {
  it("reads the user-facing limitations, with task links pointing at ROADMAP.md", () => {
    expect(knownLimitations(ROADMAP)).toEqual([
      {
        title: "Views",
        items: [
          "Views are behind the internal `LUCENT_VIEWS=fabric` switch, off by default.",
          "Native views' JSX has fixed children ([T49](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md#t49)'s).",
        ],
      },
      { title: "Language, runtime and bindings", items: ["Weak references are missing."] },
    ]);
  });
});
