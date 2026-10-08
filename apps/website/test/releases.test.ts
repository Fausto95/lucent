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

const LIMITATIONS = `# Known limitations and deferred checks

What Lucent doesn't do yet.

## Deferred checks (need the maintainer)

- **Physical devices.** Not run.

## Views

- Views are in preview: \`lucent:ui\` and its toolkits may change
  without notice.
- Native views' JSX has fixed children ([T49](tasks.md#t49)'s).
- Cycles leak ([Not planned](../ROADMAP.md#not-planned)).

## Language, runtime and bindings

- Weak references are missing.
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
  it("reads the user-facing limitations of docs/limitations.md, with links to GitHub", () => {
    expect(knownLimitations(LIMITATIONS)).toEqual([
      {
        title: "Views",
        items: [
          "Views are in preview: `lucent:ui` and its toolkits may change without notice.",
          "Native views' JSX has fixed children ([T49](https://github.com/Fausto95/lucent/blob/main/docs/tasks.md#t49)'s).",
          "Cycles leak ([Not planned](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md#not-planned)).",
        ],
      },
      { title: "Language, runtime and bindings", items: ["Weak references are missing."] },
    ]);
  });
});
