import { parseSync } from "oxc-parser";
import type * as ES from "@oxc-project/types";
import type { NativeReferenceBinding, ThreadContext } from "../libraries.ts";
import { diagnostic, type Diagnostic, type Span } from "../diagnostics/index.ts";
const CONTEXTS: Readonly<Record<string, ThreadContext>> = {
  MainThread: "main",
  Background: "worker",
  Inherited: "caller",
};

/** Recognize the Lucent extension before Oxc, retaining every source offset.
 * Strings, template interpolations, and comments are skipped as lexical units.
 */
/** A decorator occurrence: its span, its name, and the raw text of any argument list. */
export interface DecoratorUse extends Span {
  name: string;
  /** Raw argument text, or null when the decorator was written without a list. */
  args: string | null;
}

export function maskDecorators(source: string): { source: string; decorators: DecoratorUse[] } {
  const decorators: DecoratorUse[] = [],
    chars = source.split("");
  const skip = (start: number): number => {
    const quote = source[start];
    let i = start + 1;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === quote) return i + 1;
      if (quote === "`" && source.slice(i, i + 2) === "${") {
        i = balanced(i + 2);
        continue;
      }
      i++;
    }
    return i;
  };
  const comment = (i: number): number =>
    source[i + 1] === "/"
      ? source.indexOf("\n", i + 2) < 0
        ? source.length
        : source.indexOf("\n", i + 2)
      : source.indexOf("*/", i + 2) < 0
        ? source.length
        : source.indexOf("*/", i + 2) + 2;
  const balanced = (start: number): number => {
    let depth = 1,
      i = start;
    while (i < source.length && depth) {
      if ("\"'`".includes(source[i]!)) {
        i = skip(i);
        continue;
      }
      if (source[i] === "/" && ["/", "*"].includes(source[i + 1]!)) {
        i = comment(i);
        continue;
      }
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      i++;
    }
    return i;
  };
  /** Index just past the `)` matching the `(` at `start`. */
  const parens = (start: number): number => {
    let depth = 0,
      i = start;
    while (i < source.length) {
      if ("\"'`".includes(source[i]!)) {
        i = skip(i);
        continue;
      }
      if (source[i] === "(") depth++;
      if (source[i] === ")" && --depth === 0) return i + 1;
      i++;
    }
    return i;
  };
  let i = 0,
    depth = 0;
  while (i < source.length) {
    if ("\"'`".includes(source[i]!)) {
      i = skip(i);
      continue;
    }
    if (source[i] === "/" && ["/", "*"].includes(source[i + 1]!)) {
      i = comment(i);
      continue;
    }
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0 && source[i] === "@") {
      const name = /^@[A-Za-z_$][\w$]*/.exec(source.slice(i));
      if (name) {
        let end = i + name[0].length;
        // An argument list belongs to the decorator, so mask it too; leaving it
        // behind would reach the JavaScript parser as a stray call expression.
        let args: string | null = null;
        if (source[end] === "(") {
          const close = parens(end);
          args = source.slice(end + 1, close - 1);
          end = close;
        }
        decorators.push({ start: i, end, name: name[0].slice(1), args });
        for (let j = i; j < end; j++) chars[j] = " ";
        i = end;
        continue;
      }
    }
    i++;
  }
  return { source: chars.join(""), decorators };
}
/**
 * Decorator arguments as plain data.
 *
 * They are masked out before the module is parsed, so oxc never sees them in
 * place; parsing the argument text on its own keeps the accepted grammar the
 * real one instead of whatever a regular expression happens to match. Only
 * literals and literal-valued objects and arrays are data — anything else is
 * rejected rather than guessed at.
 */
/** Plain data from a literal expression, or null when the node is not one. */
const literal = (node: ES.Expression): { value: unknown } | null => {
  if (node.type === "Literal") return { value: node.value };
  if (node.type === "ArrayExpression") {
    const items: unknown[] = [];
    for (const element of node.elements) {
      if (!element || element.type === "SpreadElement") return null;
      const item = literal(element);
      if (!item) return null;
      items.push(item.value);
    }
    return { value: items };
  }
  if (node.type === "ObjectExpression") {
    const record: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed) return null;
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : property.key.type === "Literal"
            ? String(property.key.value)
            : null;
      const item = key === null ? null : literal(property.value);
      if (key === null || !item) return null;
      record[key] = item.value;
    }
    return { value: record };
  }
  return null;
};

export function decoratorArguments(args: string | null): unknown[] | null {
  if (args === null) return null;
  if (args.trim() === "") return [];
  const parsed = parseSync("decorator.ts", `[${args}]`);
  if (parsed.errors.length) return null;
  const statement = parsed.program.body[0];
  if (parsed.program.body.length !== 1 || statement?.type !== "ExpressionStatement") return null;
  const list = literal(statement.expression);
  return list && Array.isArray(list.value) ? (list.value as unknown[]) : null;
}

// A reference is held by Lucent or by the SDK; a borrow is a call-site property.
const OWNERSHIP = new Set(["owned", "external"]);
const EXECUTORS = new Set(["caller", "main", "worker", "serial"]);

/** Validates the `@NativeReference` argument object into a reference binding. */
function nativeReference(value: unknown): NativeReferenceBinding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { swift, kotlin, ownership, executor, transferable, ...rest } = record;
  if (Object.keys(rest).length) return null;
  if (typeof swift !== "string" || typeof kotlin !== "string" || !swift || !kotlin) return null;
  if (transferable !== undefined && typeof transferable !== "boolean") return null;
  // Ownership and executor travel together: the checks that read one read the
  // other, and a half-stated contract would silently relax both.
  if (ownership === undefined && executor === undefined) return transferable === undefined ? { swift, kotlin } : null;
  if (typeof ownership !== "string" || !OWNERSHIP.has(ownership)) return null;
  if (typeof executor !== "string" || !EXECUTORS.has(executor)) return null;
  return {
    swift,
    kotlin,
    contract: {
      ownership: ownership as "owned" | "external",
      executor: executor as "caller" | "main" | "worker" | "serial",
      ...(transferable === undefined ? {} : { transferable }),
    },
  };
}

export function functionDecorators(
  masked: string,
  body: ES.Statement[],
  decorators: readonly DecoratorUse[],
  comments: readonly { start: number; end: number }[],
) {
  const nativeOnly = new Set<number>();
  const sidecar = new Set<number>();
  const capabilities = new Map<number, string[]>();
  const nativeReferences = new Map<number, NativeReferenceBinding>();
  const threads = new Map<number, ThreadContext>(),
    diagnostics: Diagnostic[] = [];
  const trivia = (start: number, end: number) => {
    let text = masked.slice(start, end);
    for (const c of comments.toReversed())
      if (c.start >= start && c.end <= end)
        text = text.slice(0, c.start - start) + " ".repeat(c.end - c.start) + text.slice(c.end - start);
    return text.trim() === "";
  };
  const stmtFor = (span: DecoratorUse) => {
    const stmt = body.find((s) => s.start >= span.end && trivia(span.end, s.start));
    return stmt?.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
  };
  for (const span of decorators) {
    const stmt = body.find((s) => s.start >= span.end && trivia(span.end, s.start));
    const fn = stmt?.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    const name = span.name;
    const context = CONTEXTS[name];
    const bare = span.args === null;
    if (
      name === "NativeOnly" &&
      bare &&
      fn &&
      (fn.type === "FunctionDeclaration" || fn.type === "TSDeclareFunction") &&
      !nativeOnly.has(fn.start)
    ) {
      nativeOnly.add(fn.start);
      continue;
    }
    // `@NativeReference({ swift, kotlin, ownership, executor, transferable })`
    // maps a record alias onto an SDK type. The contract is what the borrow and
    // executor checks read, so it is written out rather than inferred.
    if (name === "NativeReference" && stmtFor(span)?.type === "TSTypeAliasDeclaration") {
      const alias = stmtFor(span)!;
      const parsed = decoratorArguments(span.args);
      const value = parsed?.length === 1 ? parsed[0] : null;
      const binding = nativeReference(value);
      if (!binding)
        diagnostics.push(
          diagnostic(
            "LUCENT1001",
            span,
            "@NativeReference takes one object with `swift` and `kotlin` type names, and optional ownership, executor and transferable.",
          ),
        );
      else nativeReferences.set(alias.start, binding);
      continue;
    }
    // `@Capability("crypto", "filesystem")` states what the implementation needs.
    // The build rejects a module whose capabilities the app has not declared.
    if (name === "Capability" && fn && (fn.type === "FunctionDeclaration" || fn.type === "TSDeclareFunction")) {
      const parsed = decoratorArguments(span.args);
      const names = parsed?.every((value) => typeof value === "string" && /^[A-Za-z][\w-]*$/.test(value))
        ? (parsed as string[])
        : null;
      if (!names?.length)
        diagnostics.push(
          diagnostic("LUCENT1001", span, "@Capability takes one or more string literal capability names."),
        );
      else capabilities.set(fn.start, [...(capabilities.get(fn.start) ?? []), ...names]);
      continue;
    }
    // `@Native` marks a declaration implemented by a sidecar `.swift`/`.kt` file.
    if (name === "Native" && bare && fn?.type === "TSDeclareFunction" && !sidecar.has(fn.start)) {
      sidecar.add(fn.start);
      continue;
    }
    if (
      !context ||
      !bare ||
      !fn ||
      (fn.type !== "FunctionDeclaration" && fn.type !== "TSDeclareFunction") ||
      threads.has(fn.start)
    )
      diagnostics.push(
        diagnostic(
          "LUCENT1001",
          span,
          name === "Native"
            ? "@Native applies once to a `declare function`, whose body lives in a sidecar .swift/.kt file."
            : "Use at most one @NativeOnly and one of @MainThread, @Background, or @Inherited before a function.",
        ),
      );
    else threads.set(fn.start, context);
  }
  return { threads, nativeOnly, sidecar, capabilities, nativeReferences, diagnostics };
}
