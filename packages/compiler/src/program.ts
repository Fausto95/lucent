import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Codes, type Diagnostic } from "./diagnostics.ts";
import { cppIdent } from "./types.ts";

export interface LucentModule {
  /** Module name used from JavaScript: the file name without `.lucent.ts`. */
  name: string;
  file: string;
  sourceFile: ts.SourceFile;
  /** C++ namespace inside `lucent_app`. */
  ns: string;
}

export interface LucentProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  modules: LucentModule[];
  diagnostics: Diagnostic[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Path of `@lucent-lang/core` type declarations. */
export function coreTypesPath(): string {
  return path.resolve(here, "../../core/index.d.ts");
}

export const LUCENT_EXTENSION = /\.lucent\.tsx?$/;

export function moduleNameOf(file: string): string {
  return path.basename(file).replace(LUCENT_EXTENSION, "");
}

export function compilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts"],
    types: [],
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    noFallthroughCasesInSwitch: false,
    exactOptionalPropertyTypes: false,
    // Reading a missing index yields undefined at runtime; the types must say so.
    noUncheckedIndexedAccess: true,
    paths: { "@lucent-lang/core": [coreTypesPath()] },
  };
}

/** Finds `*.lucent.ts` files under `root`, skipping node_modules and build output. */
export function findLucentFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "ios" || entry.name === "android") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (LUCENT_EXTENSION.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function createLucentProgram(files: string[]): LucentProgram {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const program = ts.createProgram(files.map((f) => path.resolve(f)), options, host);
  const checker = program.getTypeChecker();
  const diagnostics: Diagnostic[] = [];
  const modules: LucentModule[] = [];
  const names = new Map<string, string>();
  for (const file of files) {
    const sf = program.getSourceFile(path.resolve(file));
    if (!sf) continue;
    const name = moduleNameOf(file);
    const clash = names.get(name);
    if (clash) {
      diagnostics.push({ code: Codes.UnsupportedTopLevel, message: `two Lucent modules are named "${name}": ${clash} and ${file}`, file });
      continue;
    }
    names.set(name, file);
    modules.push({ name, file: sf.fileName, sourceFile: sf, ns: `m_${cppIdent(name)}` });
  }
  for (const m of modules) {
    for (const d of [...program.getSyntacticDiagnostics(m.sourceFile), ...program.getSemanticDiagnostics(m.sourceFile)]) {
      diagnostics.push(fromTs(d));
    }
  }
  return { program, checker, modules, diagnostics };
}

function fromTs(d: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return { code: Codes.TypeScript, message: `TS${d.code}: ${message}`, file: d.file.fileName, line: line + 1, column: character + 1 };
  }
  return { code: Codes.TypeScript, message: `TS${d.code}: ${message}` };
}
