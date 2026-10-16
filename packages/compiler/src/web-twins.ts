/**
 * Modules' web twins (decision 0133): `m.web.lucent.ts` beside `m.lucent.ts` is plain
 * TypeScript, which the web bundle runs in m's place. Lucent doesn't
 * compile a twin: each is type-checked with the DOM's types, and against
 * m's exports, in a program of the twins alone. Native builds leave twins
 * out (findLucentFiles).
 */
import path from "node:path";
import ts from "typescript";
import { Codes, type Diagnostic } from "./diagnostics.ts";
import {
  cachedDeclaration,
  coreTypesPath,
  globalsPath,
  type ReadSource,
  sdkLibPath,
} from "./program.ts";
import { fileExists, readText, realpath } from "./reads.ts";

/** A module's web twin: `m.web.lucent.ts`. */
export const WEB_TWIN = /\.web\.lucent\.ts$/;

/** The twin of a module's file (`m.lucent.ts`, or a platform's `m.ios.lucent.ts`): `m.web.lucent.ts`. */
export const twinOf = (file: string): string =>
  file.replace(/(\.(ios|android))?\.lucent\.tsx?$/, ".web.lucent.ts");

/** The file of the module a twin stands in for: `m.lucent.ts`. */
export const moduleOfTwin = (twin: string): string => twin.replace(WEB_TWIN, ".lucent.ts");

/** The twins of `files`' modules that exist, each once: looked for as a compile reads (missing ones too). */
export function webTwins(files: readonly string[]): string[] {
  const twins = new Set(
    files
      .filter((f) => !WEB_TWIN.test(f) && !f.endsWith(".tsx"))
      .map((f) => twinOf(path.resolve(f))),
  );

  return [...twins].filter((t) => fileExists(t)).sort();
}

/** The virtual file that checks `twin` against its module's exports. */
const checkFileOf = (twin: string) =>
  path.join(path.dirname(twin), `__lucent_web_twin__${path.basename(twin)}`);

/** Lucent's modules a twin may import: their JavaScript is in the web bundle. */
const WEB_MODULES: Record<string, () => string> = {
  "lucent:core": coreTypesPath,
  "lucent:platform": () => sdkLibPath("platform"),
  "lucent:thread": () => sdkLibPath("thread"),
};

/**
 * What is wrong with `twins`: their own TypeScript errors, with the DOM's
 * types, and LUCENT3005 for a twin that doesn't give its module's exports
 * their types, at the twin. `readSource` gives an editor's unsaved text.
 */
export function twinProblems(twins: readonly string[], readSource?: ReadSource): Diagnostic[] {
  if (!twins.length) return [];

  const checks = new Map(
    twins.map((twin) => {
      const module = path.basename(moduleOfTwin(twin), ".ts");
      const text = [
        `import * as twin from ${JSON.stringify(`./${path.basename(twin, ".ts")}`)};`,
        `import type * as module from ${JSON.stringify(`./${module}`)};`,
        "export const exports: typeof module = twin;",
        "",
      ].join("\n");
      return [checkFileOf(twin), { twin, text }];
    }),
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const virtual = (f: string) => checks.get(path.resolve(f))?.text ?? readSource?.(path.resolve(f));
  // Disk reads are noted (reads.ts): an edited twin or module checks again.
  host.readFile = (f) => virtual(f) ?? readText(f);
  host.fileExists = (f) => virtual(f) !== undefined || fileExists(f);
  host.realpath = (f) => (virtual(f) === undefined ? realpath(f) : f);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, language, onError, create) => {
    const text = virtual(f);
    if (text !== undefined) return ts.createSourceFile(f, text, language, true);
    // The DOM's library and other declarations parse once per process.
    if (f.endsWith(".d.ts")) {
      const declared = readText(f);
      return declared === undefined ? undefined : cachedDeclaration(f, declared, language);
    }
    return getSourceFile(f, language, onError, create);
  };
  host.resolveModuleNameLiterals = (literals, containing, redirected, opts) =>
    literals.map((literal) => {
      const lucent = WEB_MODULES[literal.text];
      if (lucent)
        return {
          resolvedModule: {
            resolvedFileName: lucent(),
            extension: ts.Extension.Dts,
            isExternalLibraryImport: false,
          },
        };
      return ts.resolveModuleName(literal.text, containing, opts, host, undefined, redirected);
    });

  const program = ts.createProgram({
    rootNames: [globalsPath(), ...twins, ...checks.keys()],
    options,
    host,
  });

  const out: Diagnostic[] = [];
  const own = new Set(twins.map((t) => path.resolve(t)));
  for (const sf of program.getSourceFiles()) {
    const file = path.resolve(sf.fileName);
    const check = checks.get(file);
    if (!own.has(file) && !check) continue;

    const found = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    for (const d of found) {
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (check) out.push(conformance(check.twin, message));
      else out.push(at(sf, d, `TS${d.code}: ${message}`));
    }
  }

  return out;
}

/** A twin's own TypeScript error, at its position. */
function at(sf: ts.SourceFile, d: ts.Diagnostic, message: string): Diagnostic {
  const start = d.start ?? 0;
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return {
    code: Codes.TypeScript,
    message,
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    start,
    length: d.length ?? 0,
  };
}

/** LUCENT3005 at a twin whose exports aren't its module's. */
function conformance(twin: string, message: string): Diagnostic {
  const module = path.basename(moduleOfTwin(twin));
  // The modules by their files' names, not TypeScript's `typeof import("<path>")`.
  const named = (text: string, file: string) =>
    text
      .split(`typeof import(${JSON.stringify(file.replace(/\.ts$/, ""))})`)
      .join(path.basename(file));
  const why = named(named(message, twin), moduleOfTwin(twin));
  return {
    code: Codes.PlatformConformance,
    message: `${path.basename(twin)} is ${module}'s web twin, but doesn't export what ${module} exports, with its types: ${why}`,
    file: twin,
    line: 1,
    column: 1,
    fix: `export from ${path.basename(twin)} each of ${module}'s exports, with the same types`,
  };
}
