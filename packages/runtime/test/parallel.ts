/**
 * Running builds side by side, for the harnesses that compile the runtime
 * and generated code (e2e, app-check, bench): processes run concurrently,
 * as many as there are cores, unlike the spawnSync each build used to wait on.
 */
import { spawn } from "node:child_process";
import os from "node:os";

/** One per core, unless LUCENT_TEST_JOBS says how many. */
export const cores = Number(process.env.LUCENT_TEST_JOBS ?? os.availableParallelism());

export /** What `cmd` exits with, and what it wrote. */
function exec(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: opts.env });
    const [stdout, stderr] = [[] as Buffer[], [] as Buffer[]];
    // Unreferenced, so that a reference run waiting for its own timers does not count it.
    const limit = opts.timeout
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeout).unref()
      : undefined;

    child.stdout.on("data", (d: Buffer) => stdout.push(d));
    child.stderr.on("data", (d: Buffer) => stderr.push(d));
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(limit);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export /** `work` over each item, at most `n` at a time: each result in the items' order, as it settles. */
function pool<T, R>(items: T[], n: number, work: (item: T) => Promise<R>): Promise<R>[] {
  const results = items.map(() => {
    const r = {} as { promise: Promise<R>; resolve: (v: R) => void; reject: (e: unknown) => void };

    r.promise = new Promise<R>((resolve, reject) => Object.assign(r, { resolve, reject }));
    return r;
  });
  let next = 0;

  // A result nobody awaits yet must not be an unhandled rejection; its await still throws.
  for (const r of results) r.promise.catch(() => {});

  const worker = async () => {
    for (let i = next++; i < items.length; i = next++)
      await work(items[i]!).then(results[i]!.resolve, results[i]!.reject);
  };

  for (let k = 0; k < Math.min(n, items.length); k++) void worker();
  return results.map((r) => r.promise);
}

/** `cmd` run to its exit; throws with what it printed when it fails. */
export async function run(
  cmd: string,
  args: string[],
  opts: { timeout?: number } = {},
): Promise<string> {
  const r = await exec(cmd, args, opts);

  if (r.status !== 0)
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${r.status ?? r.signal}):\n${r.stderr}\n${r.stdout}`,
    );
  return r.stdout;
}
