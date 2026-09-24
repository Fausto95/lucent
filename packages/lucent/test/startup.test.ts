import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");
// Reports every module resolved in the child, so the test sees what a command loads.
const hook = `data:text/javascript,${encodeURIComponent('import { registerHooks } from "node:module"; registerHooks({ resolve(s, c, next) { process.stderr.write("[resolve] " + s + "\\n"); return next(s, c); } });')}`;

function loaded(...args: string[]): { status: number | null; out: string; modules: string[] } {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", hook, main, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const modules = r.stderr.split("\n").filter((l) => l.startsWith("[resolve] ")).map((l) => l.slice("[resolve] ".length));
  return { status: r.status, out: r.stdout + r.stderr.split("\n").filter((l) => !l.startsWith("[resolve] ")).join("\n"), modules };
}

describe("start-up", () => {
  for (const args of [["--help"], ["--version"], [], ["explain", "LUCENT1001"]]) {
    it(`lucent ${args.join(" ") || "(no arguments)"} loads neither TypeScript nor the compiler`, () => {
      const r = loaded(...args, "--root", path.join(import.meta.dirname, "no-such-project"));
      // The compiler's dependency-free entries (codes, packages) are fine; its main entry loads TypeScript.
      expect(r.modules.filter((m) => m === "typescript" || m === "@lucent-lang/compiler" || m === "ink" || m === "react")).toEqual([]);
    });
  }

  it("prints the version", () => {
    const r = loaded("--version");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^lucent \d+\.\d+\.\d+/);
  });
});
