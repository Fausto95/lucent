/**
 * Programs for the analysis tests: Lucent modules written to a temporary
 * directory, with a `native.d.ts` whose declarations stand for SDK code.
 * Their facts come from JSDoc tags, so a test states exactly what the
 * binding plans would say:
 *
 *   @affinity main|worker|any   (a class's, or a member's own)
 *   @blocking yes|no
 *   @callback <index> escaping|during-call [main] [queued]
 *   @throws
 *   @delivery sync|queued       (a protocol member or a method Lucent implements or overrides)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  analyze,
  type AnalysisInput,
  type NativeFactsSource,
  type NativeUse,
  type ProgramFacts,
  type Unit,
} from "../../src/analysis/index.ts";
import { createLucentProgram } from "../../src/program.ts";

export const NATIVE = `/** @affinity main */
export declare class View {
  constructor();
  title: string;
  setTitle(title: string): void;
  /** @callback 0 escaping main */
  onTap(listener: () => void): void;
  /** @callback 0 during-call */
  each(visit: (n: number) => void): void;
}

/** @affinity worker */
export declare class Disk {
  /** @blocking yes */
  static read(path: string): string;
}

/** @affinity any */
export declare class Clock {
  static now(): number;
}

export declare class Sensor {
  value(): number;
}

/** @affinity main */
export interface Listener {
  /** @delivery sync */
  changed(): void;
}

export declare function vibrate(): void;

/** @affinity main */
export declare class Controller {
  constructor();
  /** @delivery sync */
  appeared(): void;
}

export declare class Monitor {
  constructor();
  /** @callback 0 escaping queued */
  watch(handler: (up: boolean) => void): void;
}

export interface Answers {
  /** @delivery queued */
  answered(): void;
}

/** @affinity main */
export declare class Chooser {
  constructor();
  delegate: Answers;
}
`;

/** Writes `modules` (name → source) and `native.d.ts` to a new directory; the module files. */
export function write(modules: Record<string, string>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-analysis-"));

  fs.writeFileSync(path.join(dir, "native.d.ts"), NATIVE);

  return Object.entries(modules).map(([name, text]) => {
    const file = path.join(dir, `${name}.lucent.ts`);

    fs.writeFileSync(file, text);
    return file;
  });
}

/** The facts of a program of `modules`, checked first; `input` overrides the analysis input. */
export function facts(
  modules: Record<string, string>,
  input: Partial<AnalysisInput> = {},
): ProgramFacts & { checker: ts.TypeChecker } {
  const lp = createLucentProgram(write(modules));

  if (lp.diagnostics.length) throw new Error(lp.diagnostics.map((d) => d.message).join("\n"));

  const analysed = analyze({ checker: lp.checker, modules: lp.modules, native: STUB, ...input });

  return Object.assign(analysed, { checker: lp.checker });
}

/** The facts of a one-module program `m`. */
export function one(source: string): ProgramFacts & { checker: ts.TypeChecker } {
  return facts({ m: source });
}

/** A unit by id, failing loudly when it is not there. */
export function unit(f: ProgramFacts, id: string): Unit {
  const u = f.byId(id);

  if (!u) throw new Error(`no unit ${id}; have ${f.units.map((x) => x.id).join(", ")}`);

  return u;
}

/** A tag's text on `node`, or on its class when `inherit`. */
function tag(node: ts.Node, name: string, inherit = true): string | undefined {
  const own = ts.getJSDocTags(node).find((t) => t.tagName.text === name);
  const text = own && (ts.getTextOfJSDocComment(own.comment) ?? "");

  if (text !== undefined) return text.trim();

  const owner = node.parent;

  return inherit && owner && (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner))
    ? tag(owner, name, false)
    : undefined;
}

function isNative(decl: ts.Node): boolean {
  return path.basename(decl.getSourceFile().fileName) === "native.d.ts";
}

const SCALARS = new Set([
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.BooleanKeyword,
]);

function useOf(decl: ts.Declaration): NativeUse {
  const name = (decl as ts.NamedDeclaration).name;
  const owner =
    ts.isClassDeclaration(decl.parent) || ts.isInterfaceDeclaration(decl.parent)
      ? decl.parent.name?.text
      : undefined;
  const display = [owner, name && ts.isIdentifier(name) ? name.text : "new"]
    .filter(Boolean)
    .join(".");
  const params = ts.isFunctionLike(decl) ? decl.parameters : [];
  const callbacks = new Map(
    ts
      .getJSDocTags(decl)
      .filter((t) => t.tagName.text === "callback")
      .map((t) => {
        const [index, timing, ...rest] = (ts.getTextOfJSDocComment(t.comment) ?? "")
          .trim()
          .split(/\s+/);

        return [
          Number(index),
          {
            timing: timing as "escaping" | "during-call",
            main: rest.includes("main"),
            ...(rest.includes("queued") ? { delivery: "queued" as const } : {}),
          },
        ];
      }),
  );
  const copies = new Set(params.flatMap((p, i) => (p.type && SCALARS.has(p.type.kind) ? [i] : [])));
  const delivery = tag(decl, "delivery", false);

  return {
    display,
    facts: {
      affinity: (tag(decl, "affinity") ?? "unknown") as NativeUse["facts"]["affinity"],
      blocking: (tag(decl, "blocking") ?? "unknown") as NativeUse["facts"]["blocking"],
      ownership: "unknown",
      evidence: [],
    },
    callbacks,
    copies,
    throws: tag(decl, "throws", false) !== undefined,
    ...(delivery ? { delivery: delivery as "sync" | "queued" } : {}),
  };
}

/** Native facts from the tags of native.d.ts. */
export const STUB: NativeFactsSource = {
  use: (decl) => (isNative(decl) ? useOf(decl) : undefined),

  classOf: (decl) =>
    ts.isClassDeclaration(decl) && isNative(decl)
      ? {
          display: decl.name?.text ?? "class",
          affinity: (tag(decl, "affinity") ?? "unknown") as "main" | "worker" | "any" | "unknown",
        }
      : undefined,

  implemented(checker, method) {
    const cls = method.parent;
    if (!ts.isClassLike(cls) || !ts.isIdentifier(method.name)) return undefined;

    for (const h of cls.heritageClauses ?? [])
      for (const t of h.types) {
        const decl = checker.getTypeAtLocation(t).getSymbol()?.declarations?.[0];
        const member =
          decl && (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) && isNative(decl)
            ? decl.members.find(
                (m) =>
                  m.name &&
                  ts.isIdentifier(m.name) &&
                  m.name.text === (method.name as ts.Identifier).text,
              )
            : undefined;

        if (member) return useOf(member);
      }

    return undefined;
  },
};
