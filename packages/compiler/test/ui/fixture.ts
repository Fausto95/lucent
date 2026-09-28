/**
 * Programs for the view analysis tests: Lucent modules written to a
 * temporary package, with the analysis fixture's `native.d.ts` (its `View`
 * stands for a platform's root view class) and a `ui.d.ts` declaring the
 * view helpers the analysis recognizes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createLucentProgram } from "../../src/program.ts";
import type { Platform } from "../../src/sdk/schema.ts";
import { analyzeViews, type ViewAnalysis, type ViewEnv } from "../../src/ui/analyze.ts";
import { NATIVE, STUB } from "../analysis/fixture.ts";

export const VIEWS = `${NATIVE}
/** @affinity main */
export declare class Label extends View {
  constructor();
  text: string;
}

/** @affinity main */
export declare class Widget {
  constructor();
}
`;

export const UI = `export declare function expose<T extends object>(commands: T): void;

export interface Children {
  readonly __lucentChildren: never;
}

export declare function slot<T extends object>(): T;

declare const delivery: unique symbol;

export type Continuous<F extends (...args: never[]) => void> = F & {
  readonly [delivery]?: "continuous";
};

export type Coalesced<F extends (...args: never[]) => void> = F & {
  readonly [delivery]?: "coalesced";
};
`;

const declaredIn = (decl: ts.Node, file: string) =>
  path.basename(decl.getSourceFile().fileName) === file;

/** `View` stands for iOS's root view class, `Widget` for Android's; either is its platform's slot container too. */
const platformView = (decl: ts.ClassDeclaration): Platform | undefined => {
  if (!declaredIn(decl, "native.d.ts")) return undefined;

  return decl.name?.text === "View" ? "ios" : decl.name?.text === "Widget" ? "android" : undefined;
};

/** A helper of ui.d.ts, as lucent:ui's. */
const uiFunction = (decl: ts.Declaration, name: string) =>
  declaredIn(decl, "ui.d.ts") && ts.isFunctionDeclaration(decl) && decl.name?.text === name;

/** Roots and slot containers from native.d.ts; `expose`, `slot`, `Children` and the delivery marks from ui.d.ts. */
export const ENV: ViewEnv = {
  native: STUB,
  root: platformView,
  container: platformView,
  expose: (decl) => uiFunction(decl, "expose"),
  slot: (decl) => uiFunction(decl, "slot"),
  children: (decl) =>
    declaredIn(decl, "ui.d.ts") && ts.isInterfaceDeclaration(decl) && decl.name.text === "Children",
  delivery: (decl) =>
    declaredIn(decl, "ui.d.ts") &&
    ts.isPropertySignature(decl) &&
    ts.isComputedPropertyName(decl.name) &&
    ts.isIdentifier(decl.name.expression) &&
    decl.name.expression.text === "delivery",
};

export interface Options {
  /** The program's target (default ios). */
  platform?: Platform | "host";
  /** The package.json at the root, or its text; null: none. */
  pkg?: Record<string, unknown> | string | null;
  /** Files the checker sees but that are not compiled (platform modules' declarations). */
  references?: string[];
}

/** Writes `files` (relative path → text) with the fixture declarations; the directory. */
export function write(files: Record<string, string>, pkg: Options["pkg"]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-views-"));
  const all: Record<string, string> = { "native.d.ts": VIEWS, "ui.d.ts": UI, ...files };

  if (pkg !== null)
    all["package.json"] =
      typeof pkg === "string" ? pkg : JSON.stringify(pkg ?? { name: "@acme/app" });

  for (const [name, text] of Object.entries(all)) {
    const file = path.join(dir, name);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  return dir;
}

/** The view analysis of the Lucent files among `files`, type-checked first. */
export function views(files: Record<string, string>, options: Options = {}): ViewAnalysis {
  const dir = write(files, options.pkg);
  const references = (options.references ?? []).map((f) => path.join(dir, f));
  const lucent = Object.keys(files)
    .map((f) => path.join(dir, f))
    .filter((f) => /\.lucent\.tsx?$/.test(f) && !references.includes(f));
  const target = options.platform ?? "ios";
  const lp = createLucentProgram(lucent, undefined, target === "host" ? undefined : target, {
    references,
  });

  if (lp.diagnostics.length) throw new Error(lp.diagnostics.map((d) => d.message).join("\n"));

  return analyzeViews(lp, ENV);
}

/** One module, `name.lucent.tsx`, in package `@acme/app`. */
export function one(source: string, name = "m"): ViewAnalysis {
  return views({ [`${name}.lucent.tsx`]: source });
}

/** The messages of an analysis's diagnostics with `code`. */
export function messages(a: ViewAnalysis, code?: string): string[] {
  return a.diagnostics.filter((d) => !code || d.code === code).map((d) => d.message);
}
