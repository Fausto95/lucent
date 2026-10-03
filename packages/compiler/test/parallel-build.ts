/**
 * Compiling side by side from tests that wait for the result: a test's
 * helpers here are synchronous, so the compilers run from one shell script,
 * one per core, while the test waits for it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Compiles each of `jobs` (a compiler and its arguments, writing `object`)
 * side by side, one per core: what they printed, together.
 */
export function compileAll(jobs: { cmd: string; args: string[]; object: string }[]): string {
  if (!jobs.length) return "";

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-parallel-build-"));
  const q = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
  const cores = os.availableParallelism();
  const lines = jobs.map(
    (j, i) =>
      `(${[j.cmd, ...j.args, "-o", j.object].map(q).join(" ")}) >${q(path.join(dir, `${i}.log`))} 2>&1 &${(i + 1) % cores === 0 ? "\nwait" : ""}`,
  );

  fs.writeFileSync(path.join(dir, "build.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(dir, "build.sh")]);

  const printed = jobs.map((_, i) => fs.readFileSync(path.join(dir, `${i}.log`), "utf8")).join("");

  fs.rmSync(dir, { recursive: true, force: true });
  return printed;
}
