/**
 * Compiling side by side from tests that wait for the result: a test's
 * helpers here are synchronous, so the compilers run from one shell script,
 * one per core, while the test waits for it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Job {
  cmd: string;
  args: string[];
  /** Where it runs (the test's directory by default). */
  cwd?: string;
}

/** Runs each of `jobs` side by side, one per core: each one's exit status and what it printed. */
export function runAll(jobs: Job[]): { status: number; output: string }[] {
  if (!jobs.length) return [];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-parallel-build-"));
  const q = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
  const cores = os.availableParallelism();
  const lines = jobs.map((j, i) => {
    const command = [j.cmd, ...j.args].map(q).join(" ");
    const at = j.cwd ? `cd ${q(j.cwd)} && ` : "";
    const log = q(path.join(dir, `${i}.log`));
    const status = q(path.join(dir, `${i}.status`));

    return `{ (${at}${command}) >${log} 2>&1; echo $? >${status}; } &${(i + 1) % cores === 0 ? "\nwait" : ""}`;
  });

  fs.writeFileSync(path.join(dir, "build.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(dir, "build.sh")]);

  const results = jobs.map((_, i) => ({
    status: Number(fs.readFileSync(path.join(dir, `${i}.status`), "utf8")),
    output: fs.readFileSync(path.join(dir, `${i}.log`), "utf8"),
  }));

  fs.rmSync(dir, { recursive: true, force: true });
  return results;
}

/**
 * Compiles each of `jobs` (a compiler and its arguments, writing `object`)
 * side by side, one per core: what they printed, together.
 */
export function compileAll(jobs: { cmd: string; args: string[]; object: string }[]): string {
  return runAll(jobs.map((j) => ({ cmd: j.cmd, args: [...j.args, "-o", j.object] })))
    .map((r) => r.output)
    .join("");
}
