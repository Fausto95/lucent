import { describe, expect, it } from "vite-plus/test";
import { runLucent, runToExit } from "./run-to-exit.ts";

describe("runToExit", () => {
  it("gives a process's status and output once it exits", () => {
    const r = runToExit(process.execPath, [
      "-e",
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ]);

    expect(r).toMatchObject({ status: 3, stdout: "out", stderr: "err" });
  });

  it("kills a process that does not exit in time, and says what it printed", () => {
    // Deaf to SIGTERM, like a process stuck in its exit: only SIGKILL ends it
    // before its timer does.
    const stuck = [
      "-e",
      'process.on("SIGTERM", () => {}); process.stdout.write("started"); setTimeout(() => {}, 30_000)',
    ];
    const started = Date.now();

    expect(() => runToExit(process.execPath, stuck, { timeout: 1_000 })).toThrow(
      /did not exit within 1 s[\s\S]*started/,
    );
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("names the lucent command that did not exit", () => {
    expect(() => runLucent(["--version"], { timeout: 1 })).toThrow(
      /^lucent --version did not exit within 0\.001 s/,
    );
  });
});
