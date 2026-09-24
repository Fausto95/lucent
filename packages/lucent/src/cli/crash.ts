import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ISSUES = "https://github.com/Fausto95/lucent/issues/new";

/**
 * An unexpected error ends the process with a short message, the path of a
 * log holding the stack, and where to report it; never a bare stack trace.
 */
export function installCrashHandler(version: string): void {
  const crash = (e: unknown) => {
    const error = e instanceof Error ? e : new Error(String(e));
    const dir = path.join(os.tmpdir(), "lucent-logs");
    const log = path.join(dir, `crash-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(log, `lucent ${version}\nnode ${process.version} ${process.platform}-${process.arch}\nargv: ${process.argv.slice(2).join(" ")}\n\n${error.stack ?? error.message}\n`);
    } catch {
      // Nowhere to write it: the message below still says what happened.
    }
    process.stderr.write(`\nlucent crashed: ${error.message}\n  details: ${log}\n  please report it with that file: ${ISSUES}\n`);
    process.exit(70);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
}
