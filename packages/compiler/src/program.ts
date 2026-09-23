import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Codes, type Diagnostic } from "./diagnostics.ts";
import { sdkDts, stubDts } from "./sdk/dts.ts";
import { findSdkModule, type Platform, PLATFORMS, sdkLookup, sdkNamesOf } from "./sdk/schema.ts";
import { cppIdent } from "./types.ts";

export interface LucentModule {
  /** Module name used from JavaScript: the file name without `.lucent.ts`. */
  name: string;
  file: string;
  sourceFile: ts.SourceFile;
  /** C++ namespace inside `lucent_app`. */
  ns: string;
  /** For a platform file: the shared file declaring the module's exports. */
  declaration?: ts.SourceFile;
  /** A shared declaration compiled on its own (host target): exports throw. */
  stub?: boolean;
}

export interface LucentProgram {
  program: ts.Program;
  platform?: Platform;
  checker: ts.TypeChecker;
  modules: LucentModule[];
  diagnostics: Diagnostic[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Globals Lucent code may use besides the ES2022 library (console, …). */
export function globalsPath(): string {
  return path.resolve(here, "../lib/globals.d.ts");
}

/** Whether a declaration comes from the TypeScript library or Lucent's globals. */
export function isLibFile(sf: ts.SourceFile): boolean {
  return sf.isDeclarationFile && (/[\\/]typescript[\\/]lib[\\/]lib\./.test(sf.fileName) || path.resolve(sf.fileName) === globalsPath());
}

/** Path of `@lucent-lang/core` type declarations. */
export function coreTypesPath(): string {
  // Resolved as a package, so it works both in this repository and when installed.
  return path.join(path.dirname(require.resolve("@lucent-lang/core/package.json")), "index.d.ts");
}

export const LUCENT_EXTENSION = /\.lucent\.tsx?$/;
const PLATFORM_EXTENSION = /\.(ios|android)\.lucent\.tsx?$/;

/** The module a file belongs to: `haptics` for haptics.lucent.ts and haptics.ios.lucent.ts. */
export function moduleNameOf(file: string): string {
  return path.basename(file).replace(PLATFORM_EXTENSION, "").replace(LUCENT_EXTENSION, "");
}

/** The platform of a `*.ios.lucent.ts` / `*.android.lucent.ts` file. */
export function platformOf(file: string): Platform | undefined {
  return PLATFORM_EXTENSION.exec(file)?.[1] as Platform | undefined;
}

// SDK declarations are generated from binding schemas and served from this
// virtual directory: lucent:ios/UIKit is <SDK_ROOT>/ios/UIKit.d.ts.
const SDK_ROOT = path.resolve("/__lucent_sdk__");

function sdkLibPath(name: string): string {
  return path.resolve(here, `../lib/sdk/${name}.d.ts`);
}

/**
 * Modules the program's files import get full declarations. On iOS, modules
 * only other modules' signatures mention get their types' names: extracting
 * their schemas (and their dependencies' names) would cost minutes cold.
 */
function virtualSdkText(file: string, direct: Set<string>): string | undefined {
  const rel = path.relative(SDK_ROOT, path.resolve(file));
  const m = /^(ios|android)[\\/]([\w.]+)\.d\.ts$/.exec(rel);
  if (!m) return undefined;
  const platform = m[1] as Platform;
  const module = m[2]!;
  if (platform === "ios" && !direct.has(`${platform}/${module}`)) {
    const names = sdkNamesOf(platform, module);
    return names ? stubDts(platform, module, names) : undefined;
  }
  const schema = findSdkModule(platform, module);
  if (!schema) return undefined;
  const text = sdkDts(schema);
  // Modules it re-exports are used as directly as it is.
  for (const r of text.matchAll(/^export \* from "lucent:(ios\/_\w+)";$/gm)) direct.add(r[1]!);
  return text;
}

/** `lucent:<platform>/<module>` imports written in these files. */
function directSdkImports(files: string[], readSource: ReadSource | undefined): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const text = readSource?.(path.resolve(f)) ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
    for (const m of text.matchAll(/["']lucent:(ios|android)\/([\w.]+)["']/g)) out.add(`${m[1]}/${m[2]}`);
  }
  return out;
}

/** Whether a declaration comes from an SDK binding module. */
export function sdkModuleOf(sf: ts.SourceFile): { platform: Platform; module: string } | undefined {
  const m = /^(ios|android)[\\/]([\w.]+)\.d\.ts$/.exec(path.relative(SDK_ROOT, path.resolve(sf.fileName)));
  return m ? { platform: m[1] as Platform, module: m[2]! } : undefined;
}

/** The built-in lucent:thread / lucent:ios / lucent:android module a declaration comes from. */
export function builtinSdkModuleOf(sf: ts.SourceFile): string | undefined {
  for (const name of ["thread", ...PLATFORMS]) if (path.resolve(sf.fileName) === sdkLibPath(name)) return `lucent:${name}`;
  return undefined;
}

export function compilerOptions(platform?: Platform): ts.CompilerOptions {
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
    paths: {
      "@lucent-lang/core": [coreTypesPath()],
      ...(platform
        ? {
            "lucent:thread": [sdkLibPath("thread")],
            [`lucent:${platform}`]: [sdkLibPath(platform)],
            [`lucent:${platform}/*`]: [path.join(SDK_ROOT, platform, "*.d.ts")],
          }
        : {}),
    },
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

/** Text of a file that differs from disk (an editor's unsaved buffer), if any. */
export type ReadSource = (file: string) => string | undefined;

// Library and dependency declarations parse once per process: editors check
// on every edit, and re-parsing lib.es2022 dominates otherwise.
const declarationCache = new Map<string, { text: string; sf: ts.SourceFile }>();

function compilerHost(options: ts.CompilerOptions, readSource: ReadSource | undefined, direct: Set<string>): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const sdkTexts = new Map<string, string | undefined>();
  const virtualSdk = (f: string) => {
    if (!sdkTexts.has(f)) sdkTexts.set(f, virtualSdkText(f, direct));
    return sdkTexts.get(f);
  };
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => readSource?.(path.resolve(f)) ?? readFile(f);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => readSource?.(path.resolve(f)) !== undefined || virtualSdk(f) !== undefined || fileExists(f);
  const readDisk = host.readFile;
  host.readFile = (f) => virtualSdk(f) ?? readDisk(f);
  // Module resolution skips files in directories that do not exist.
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => {
    const rel = path.relative(SDK_ROOT, path.resolve(d));
    return rel === "" || (PLATFORMS as readonly string[]).includes(rel) || (directoryExists?.(d) ?? ts.sys.directoryExists(d));
  };
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, language, onError, shouldCreate) => {
    if (!f.endsWith(".d.ts")) return getSourceFile(f, language, onError, shouldCreate);
    const text = host.readFile(f);
    if (text === undefined) return getSourceFile(f, language, onError, shouldCreate);
    const cached = declarationCache.get(f);
    if (cached?.text === text) return cached.sf;
    const sf = ts.createSourceFile(f, text, language, true);
    declarationCache.set(f, { text, sf });
    return sf;
  };
  return host;
}

/**
 * A program of Lucent modules. With a `platform`, it may contain that
 * platform's files and resolves its SDK modules; `references` are files the
 * checker sees (platform modules' shared declarations) that are not
 * compiled themselves.
 */
export function createLucentProgram(files: string[], readSource?: ReadSource, platform?: Platform, extra: { references?: string[]; stubs?: string[] } = {}): LucentProgram {
  const references = extra.references ?? [];
  const stubs = new Set((extra.stubs ?? []).map((f) => path.resolve(f)));
  const options = compilerOptions(platform);
  const host = compilerHost(options, readSource, directSdkImports(files, readSource));
  const program = ts.createProgram([...files.map((f) => path.resolve(f)), ...references.map((f) => path.resolve(f)), globalsPath()], options, host);
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
    const declaration = platformOf(file) ? references.map((r) => program.getSourceFile(path.resolve(r))).find((r) => r && path.dirname(r.fileName) === path.dirname(sf.fileName) && moduleNameOf(r.fileName) === name) : undefined;
    modules.push({ name, file: sf.fileName, sourceFile: sf, ns: `m_${cppIdent(name)}`, declaration, stub: stubs.has(path.resolve(file)) });
  }
  const checked = [...modules.map((m) => m.sourceFile), ...references.map((f) => program.getSourceFile(path.resolve(f))).filter((sf): sf is ts.SourceFile => !!sf)];
  for (const sf of checked) {
    const bad = sdkImportErrors(sf, platform);
    diagnostics.push(...bad);
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
      // An SDK import this program cannot resolve is reported once, as a Lucent error.
      if (d.code === 2307 && bad.some((b) => b.start !== undefined && d.start !== undefined && d.start >= b.start && d.start < b.start + (b.length ?? 0))) continue;
      diagnostics.push(fromTs(d));
    }
  }
  return { program, platform, checker, modules, diagnostics };
}

/** `lucent:` imports this file may not use: another platform's, unknown SDK modules, or any outside platform files. */
function sdkImportErrors(sf: ts.SourceFile, platform: Platform | undefined): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const spec = s.moduleSpecifier.text;
    const m = /^lucent:(\w+)(?:\/(.+))?$/.exec(spec);
    if (!m) continue;
    const [, scope, module] = m;
    let message: string | undefined;
    if (!platform) message = `${spec} can only be imported by platform files (*.ios.lucent.ts, *.android.lucent.ts)`;
    else if (scope === "thread" && !module) continue;
    else if (scope !== platform) message = `${spec} is only available in *.${scope}.lucent.ts files`;
    else if (module) {
      const found = sdkLookup(platform, module);
      if ("missing" in found) message = found.missing;
      else continue;
    }
    else continue;
    const start = s.moduleSpecifier.getStart(sf);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    out.push({ code: Codes.SdkImport, message, file: sf.fileName, line: line + 1, column: character + 1, start, length: s.moduleSpecifier.getEnd() - start });
  }
  return out;
}

function fromTs(d: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return { code: Codes.TypeScript, message: `TS${d.code}: ${message}`, file: d.file.fileName, line: line + 1, column: character + 1, start: d.start, length: d.length ?? 0 };
  }
  return { code: Codes.TypeScript, message: `TS${d.code}: ${message}` };
}
