/**
 * The runtime's C++ and C sources (C: the vendored regular expression
 * engine), for the test harnesses that build it: e2e, app-check, bench.
 */
import fs from "node:fs";
import path from "node:path";

export function runtimeSources(cppDir: string): { cxx: string[]; c: string[] } {
  const list = (dir: string, ext: string) =>
    fs
      .readdirSync(path.join(cppDir, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => path.join(cppDir, dir, f));
  return {
    cxx: [...list("lucent", ".cpp"), ...list("lucent/jsi", ".cpp")],
    c: list("third_party/quickjs", ".c"),
  };
}

/** Flags for the vendored C sources (third-party code: no warnings). */
export const cFlags = ["-std=c11", "-O2", "-w"];

/** Libraries the runtime needs on this host. */
export const hostLibs = process.platform === "darwin" ? ["-framework", "CoreFoundation"] : [];
