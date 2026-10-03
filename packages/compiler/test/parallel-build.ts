/**
 * Compiling side by side from tests that wait for the result: a test's
 * helpers here are synchronous, so the compilers run from one shell script,
 * one per core, while the test waits for it.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
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

/**
 * Objects of `sources`, compiled side by side: each with what `compile`
 * says (a compiler and its arguments). The ones `shared` picks (the
 * runtime's, React Native's: they do not read the program's generated
 * headers) are compiled once per test run and shared by the tests that
 * compile them the same way, keyed by their contents and the compile;
 * the others are the test's own, written into `dir`. With what the
 * compilers printed, warnings included (a shared object is only kept when
 * it compiled).
 */
export function buildObjects(
  dir: string,
  sources: string[],
  compile: (source: string) => { cmd: string; args: string[] },
  shared: (source: string) => boolean,
): { objects: string[]; printed: string } {
  const store = path.join(os.tmpdir(), "lucent-shared-objects");
  const jobs: { cmd: string; args: string[]; object: string; published?: string }[] = [];

  fs.mkdirSync(store, { recursive: true });

  const objects = sources.map((source, i) => {
    const c = compile(source);

    if (!shared(source)) {
      const object = path.join(dir, `${i}_${path.basename(source)}.o`);

      jobs.push({ ...c, object });
      return object;
    }

    const key = crypto
      .createHash("sha256")
      .update(JSON.stringify([c.cmd, c.args, source]))
      .update(fs.readFileSync(source))
      .digest("hex")
      .slice(0, 20);
    const published = path.join(store, `${key}.o`);

    if (!fs.existsSync(published))
      jobs.push({ ...c, object: `${published}.${process.pid}.${i}`, published });

    return published;
  });

  const results = runAll(jobs.map((j) => ({ cmd: j.cmd, args: [...j.args, "-o", j.object] })));

  jobs.forEach((j, i) => {
    if (j.published && results[i]!.status === 0) fs.renameSync(j.object, j.published);
  });

  return { objects, printed: results.map((r) => r.output).join("") };
}

export /** `args` without what only linking reads (-Wl, -framework): unused, they warn when compiling. */
function compileOnly(args: readonly string[]): string[] {
  return args.filter(
    (a, i) => !a.startsWith("-Wl,") && a !== "-framework" && args[i - 1] !== "-framework",
  );
}
