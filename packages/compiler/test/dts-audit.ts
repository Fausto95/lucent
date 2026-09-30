/**
 * The declaration audit: type-checks generated SDK declarations the way no
 * app does. Apps compile with skipLibCheck (React Native's and Expo's
 * tsconfig bases set it), so an invalid `.d.ts` hides there; this checks the
 * whole closure a program loads, SDK modules and Lucent's own libraries.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  builtinSdkModuleOf,
  compilerOptions,
  coreTypesPath,
  createLucentProgram,
  sdkModuleOf,
} from "../src/program.ts";
import type { Platform } from "../src/sdk/schema.ts";

/** Why a declaration is invalid, grouped for fixing (the TypeScript codes behind each). */
export type Category =
  | "protocol-merging"
  | "override-incompatible"
  | "name-collision"
  | "generic-statics"
  | "generic-arity"
  | "missing-type"
  | "invalid-supertype"
  | "other";

const CATEGORIES: Record<number, Category> = {
  // An interface (a class merged with its protocols) inheriting one name twice.
  2320: "protocol-merging",

  // A subclass or conforming type redeclaring a member incompatibly.
  2416: "override-incompatible",
  2417: "override-incompatible",
  2430: "override-incompatible",

  // Two declarations of one name.
  2300: "name-collision",
  2425: "name-collision",
  2440: "name-collision",
  2717: "name-collision",

  2302: "generic-statics",
  2315: "generic-arity",

  2304: "missing-type",
  2305: "missing-type",

  2506: "invalid-supertype",
  2840: "invalid-supertype",
};

export function categoryOf(code: number): Category {
  return CATEGORIES[code] ?? "other";
}

export interface AuditError {
  /** The declaration file's module: `UIKit`, `java.util`, `lucent:ios`. */
  module: string;
  code: number;
  category: Category;
  /** The head of TypeScript's message (its first line). */
  message: string;
}

export interface Audit {
  /** Declaration files checked. */
  files: number;
  errors: AuditError[];
}

function headMessage(d: ts.Diagnostic): string {
  const text = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
  return text.split("\n")[0]!;
}

function audited(program: ts.Program, moduleOf: (sf: ts.SourceFile) => string | undefined): Audit {
  const errors: AuditError[] = [];
  let files = 0;

  for (const sf of program.getSourceFiles()) {
    const module = moduleOf(sf);
    if (!module) continue;
    files++;

    const diagnostics = [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ];

    for (const d of diagnostics)
      errors.push({ module, code: d.code, category: categoryOf(d.code), message: headMessage(d) });
  }

  return { files, errors };
}

/**
 * Checks the declarations a program importing `modules` of `platform` loads,
 * without skipLibCheck: the modules, what their signatures reference, and
 * Lucent's own libraries.
 */
export function auditSdk(platform: Platform, modules: string[]): Audit {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-dts-audit-"));
  const file = path.join(dir, `audit.${platform}.lucent.ts`);

  const imports = [
    `import * as core from "lucent:core";`,
    `import * as thread from "lucent:thread";`,
    `import * as platformLib from "lucent:platform";`,
    `import * as sdk from "lucent:${platform}";`,
    ...modules.map((m, i) => `import * as m${i} from "lucent:${platform}/${m}";`),
    `export const used = [core, thread, platformLib, sdk, ${modules.map((_, i) => `m${i}`).join(", ")}].length;`,
  ];
  fs.writeFileSync(file, imports.join("\n") + "\n");

  try {
    const lp = createLucentProgram([file], undefined, platform, { libCheck: true });

    return audited(lp.program, (sf) => {
      if (path.resolve(sf.fileName) === coreTypesPath()) return "lucent:core";
      return sdkModuleOf(sf)?.module ?? builtinSdkModuleOf(sf);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Checks hand-written declaration texts as generated SDK modules
 * (`{ "ios/Fixture": sdkDts(schema) }`), resolving `lucent:<platform>/<module>`
 * among them and `lucent:ios` / `lucent:android` to Lucent's libraries.
 */
export function auditTexts(texts: Record<string, string>): Audit {
  const base = compilerOptions();
  // A toolkit's declarations may name lucent:ui's (a bound signal).
  const options = {
    ...base,
    skipLibCheck: false,
    paths: {
      ...base.paths,
      "lucent:ui": [path.join(import.meta.dirname, "../lib/sdk/ui.d.ts")],
    },
  };
  const sdkRoot = path.resolve("/__lucent_sdk__");
  const virtual = new Map(
    Object.entries(texts).map(([k, v]) => [path.join(sdkRoot, `${k}.d.ts`), v]),
  );

  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);

  host.readFile = (f) => virtual.get(path.resolve(f)) ?? readFile(f);
  host.fileExists = (f) => virtual.has(path.resolve(f)) || fileExists(f);
  host.directoryExists = (d) =>
    path.resolve(d).startsWith(sdkRoot) || (directoryExists?.(d) ?? ts.sys.directoryExists(d));
  host.getSourceFile = (f, language, onError, shouldCreate) => {
    const text = virtual.get(path.resolve(f));
    if (text === undefined) return getSourceFile(f, language, onError, shouldCreate);
    return ts.createSourceFile(f, text, language, true);
  };

  const program = ts.createProgram([...virtual.keys()], options, host);

  return audited(program, (sf) => {
    const rel = path.relative(sdkRoot, path.resolve(sf.fileName));
    return virtual.has(path.resolve(sf.fileName)) ? rel.replace(/\.d\.ts$/, "") : undefined;
  });
}

/** An audit as baseline entries: `module|TScode|category|message` to how many times it occurs. */
export function tally(audit: Audit): Record<string, number> {
  const out: Record<string, number> = {};

  for (const e of audit.errors) {
    const key = `${e.module}|TS${e.code}|${e.category}|${e.message}`;
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Per category, how many errors. */
export function byCategory(audit: Audit): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of audit.errors) out[e.category] = (out[e.category] ?? 0) + 1;
  return out;
}
