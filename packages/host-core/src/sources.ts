/** Filesystem boundary for CLI and Metro; the compiler receives source text only. */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { lucentImports, moduleCandidates } from "@lucent-lang/compiler";

export function loadLucentSources(fileName: string, source?: string): Record<string, string> {
  const sources: Record<string, string> = {};
  const visit = (file: string, text?: string): void => {
    if (file in sources) return;
    sources[file] = text ?? readFileSync(file, "utf8");
    for (const specifier of lucentImports(sources[file]!, file)) {
      for (const candidate of moduleCandidates(file, specifier)) {
        if (existsSync(candidate)) visit(candidate);
      }
    }
  };
  visit(resolve(fileName), source);
  return sources;
}

/** Swift and Kotlin implementing the `@Native` declarations of one Lucent file. */
export interface NativeSidecars {
  swift: Record<string, string>;
  kotlin: Record<string, string>;
}

/**
 * Reads the `.swift` and `.kt` files sitting beside each Lucent source.
 *
 * A `@Native` declaration names a symbol its sidecar defines, so the pair is
 * found by filename rather than registered anywhere: `toolkit.lucent.ts` is
 * implemented by `toolkit.swift` and `toolkit.kt`. Nothing validates that the
 * symbol exists here — `swiftc` and `kotlinc` do, at the point where a real
 * signature mismatch would show up anyway.
 */
export function loadNativeSidecars(lucentFiles: readonly string[]): NativeSidecars {
  const sidecars: NativeSidecars = { swift: {}, kotlin: {} };
  for (const file of lucentFiles) {
    const stem = resolve(file).replace(/\.lucent\.tsx?$/, "");
    for (const [language, extension] of [
      ["swift", ".swift"],
      ["kotlin", ".kt"],
    ] as const) {
      const path = stem + extension;
      if (!existsSync(path)) continue;
      const name = basename(path);
      const existing = sidecars[language][name];
      const contents = readFileSync(path, "utf8");
      if (existing !== undefined && existing !== contents)
        throw new Error(`Two Lucent modules have different ${name} sidecars; native file names must be unique.`);
      sidecars[language][name] = contents;
    }
  }
  return sidecars;
}

/**
 * Places sidecars beside the generated sources. Kotlin gets the host's package
 * declaration prepended when the file omits one, so an author writes plain
 * Kotlin without having to know the generated package name.
 */
export function emitNativeSidecars(
  files: Map<string, string>,
  sidecars: NativeSidecars | undefined,
  androidDir: string,
  androidPackage: string,
  swiftModule: string,
): void {
  // `ArrayBuffer` and the rest of the bridge types come from the host's own
  // module, which differs per host — so the import is added here rather than
  // written by an author who would have to pick one and lose portability.
  for (const [name, contents] of Object.entries(sidecars?.swift ?? {}))
    files.set(`ios/${name}`, `import ${swiftModule}\n${contents}`);
  for (const [name, contents] of Object.entries(sidecars?.kotlin ?? {})) {
    const packaged = /^\s*package\s/m.test(contents) ? contents : `package ${androidPackage}\n\n${contents}`;
    files.set(`${androidDir}/${name}`, packaged);
  }
}
