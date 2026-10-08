/**
 * One temporary directory per test run: tests and the processes they spawn
 * create their projects under it (TMPDIR, which os.tmpdir() reads), and it
 * goes when the run ends, instead of accumulating in the system's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup(): () => void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-test-run-"));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
