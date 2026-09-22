import { spawnSync } from "node:child_process";

export interface ExecResult {
  status: number | null;
  /** First line of combined stdout and stderr. */
  output: string;
}

/** Everything the CLI touches on the process. The bin passes the real thing; tests pass collectors. */
export interface IO {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  stdin?: NodeJS.ReadStream;
  exec(command: string, args: readonly string[]): ExecResult;
}

export function processIO(): IO {
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    exec: (command, args) => {
      const result = spawnSync(command, [...args], { encoding: "utf8" });
      const output = ((result.stdout ?? "") + (result.stderr ?? "")).trim().split("\n")[0] ?? "";
      return { status: result.status, output };
    },
  };
}
