/**
 * Runs a process to its exit, in tests and scripts. A synchronous spawn
 * blocks the event loop, so a test's own timeout cannot fire while it
 * waits: a process that never exits (Node has deadlocked in its own exit)
 * would freeze the whole run. This one is killed and throws instead.
 */
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import path from "node:path";

/** The CLI as its package runs it. */
export const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");

/** Well beyond any command a test runs; commands extracting an SDK pass more. */
const TIMEOUT = 120_000;

/** What the error shows of a killed process's output: its end, where it stopped. */
const TAIL = 4_000;

export type RunOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "killSignal">;

export interface Exit {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `command` until it exits. One still running after `timeout` ms is
 * killed (SIGKILL: a process stuck in its exit may not act on SIGTERM), and
 * throws, naming it by `label`, with the end of what it printed.
 */
export function runToExit(
  command: string,
  args: string[],
  options: RunOptions = {},
  label = [command, ...args].join(" "),
): Exit {
  const timeout = options.timeout ?? TIMEOUT;
  const r = spawnSync(command, args, {
    ...options,
    timeout,
    encoding: "utf8",
    killSignal: "SIGKILL",
  });

  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT")
    throw new Error(
      `${label} did not exit within ${timeout / 1000} s\n${(r.stdout + r.stderr).slice(-TAIL)}`,
      { cause: r.error },
    );

  if (r.error) throw r.error;

  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs `lucent …args` until it exits (see runToExit). */
export const runLucent = (args: string[], options: RunOptions = {}): Exit =>
  runToExit(process.execPath, [bin, ...args], options, `lucent ${args.join(" ")}`);
