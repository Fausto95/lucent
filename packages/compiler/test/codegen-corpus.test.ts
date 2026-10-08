// What the compiler generates for the end-to-end cases, for the host,
// against the committed corpus (packages/compiler/test/corpus): a change to
// code generation shows as a diff here, reviewed with the change. C++
// layout and parentheses do not count (scripts/codegen-corpus.ts); after
// an intended change, `pnpm corpus:write` writes the corpus again.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");

describe("the generated code corpus", () => {
  it("matches what the compiler generates today", () => {
    const r = spawnSync(
      process.execPath,
      ["scripts/codegen-corpus.ts", "compare", "--host", "packages/compiler/test/corpus"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, timeout: 300_000 },
    );

    // The diff, when there is one: what changed in the generated code.
    expect(r.status === 0 ? "" : `${r.stdout}${r.stderr}`).toBe("");
  }, 300_000);
});
