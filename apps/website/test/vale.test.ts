import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const config = path.join(import.meta.dirname, "../.vale.ini");
const vale = spawnSync("vale", ["--version"]).status === 0;

/** Vale's findings on one page's prose, written where scripts/website.ts writes it (.prose/<href>index.md). */
function findings(href: string, prose: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-vale-"));
  const file = path.join(dir, `${href}index.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${prose}\n`);
  const out = spawnSync("vale", ["--config", config, "--output=line", dir], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return out.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(":")[3]!);
}

describe.skipIf(!vale)("the prose rules", () => {
  it("keep the compiler's internal names off user pages", () => {
    expect(findings("/docs/architecture/boundary/", "The IR is lowered here.")).toEqual([
      "Lucent.InternalNames",
    ]);
  });

  it("let Architecture's Internals pages name them", () => {
    expect(findings("/docs/architecture/internals/compiler/", "The IR is lowered here.")).toEqual(
      [],
    );
    expect(findings("/docs/architecture/internals/", "The IR is lowered here.")).toEqual([]);
  });

  it("still hold Internals pages to the other rules", () => {
    expect(findings("/docs/architecture/internals/", "It is simply the IR.")).toEqual([
      "Lucent.BannedWords",
    ]);
  });
});
