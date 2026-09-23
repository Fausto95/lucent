import fs from "node:fs";
import path from "node:path";
import { formatDiagnostic } from "./diagnostics.ts";
import { compile } from "./index.ts";
import { inputsKey, isUpToDate, writeNativePackage } from "./native-package.ts";
import { findLucentFiles, LUCENT_EXTENSION } from "./program.ts";

export interface WatchEvent {
  ok: boolean;
  modules: string[];
  /** Diagnostics (on failure) or a summary line. */
  messages: string[];
  /** Files that native builds must pick up (C++, build files). */
  nativeChanged: boolean;
}

/**
 * Builds `root` into `outDir`, then again whenever a `*.lucent.ts` file under
 * it changes. Returns a function that stops watching.
 */
export function watchBuild(root: string, outDir: string, onBuild: (e: WatchEvent) => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  let building = false;
  let again = false;

  const build = () => {
    if (building) {
      again = true;
      return;
    }
    building = true;
    try {
      const files = findLucentFiles(root);
      const key = inputsKey(files, outDir);
      if (isUpToDate(outDir, key)) return;
      const result = compile(files);
      const modules = [...result.proxies.keys()];
      if (!result.ok) {
        onBuild({ ok: false, modules, messages: result.diagnostics.map((d) => formatDiagnostic({ ...d, file: d.file && path.relative(root, d.file) })), nativeChanged: false });
        return;
      }
      const w = writeNativePackage(result, outDir, { inputsKey: key });
      const nativeChanged = w.written.some((f) => !f.includes(`${path.sep}js${path.sep}`)) || w.removed.length > 0;
      onBuild({ ok: true, modules, messages: [`${modules.length} module(s), ${w.written.length} file(s) written`], nativeChanged });
    } finally {
      building = false;
      if (again) {
        again = false;
        build();
      }
    }
  };

  const watcher = fs.watch(root, { recursive: true }, (_event, name) => {
    if (!name || !LUCENT_EXTENSION.test(name) || name.includes("node_modules") || name.startsWith(".")) return;
    clearTimeout(timer);
    timer = setTimeout(build, 100);
  });
  build();
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
