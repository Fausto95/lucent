import type * as ES from "@oxc-project/types";
import type { ThreadContext } from "../libraries.ts";
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
export function functionDecorators(
  masked: string,
  body: ES.Statement[],
  decorators: readonly DecoratorUse[],
  comments: readonly { start: number; end: number }[],
) {
  const nativeOnly = new Set<number>();
  const sidecar = new Set<number>();
  const capabilities = new Map<number, string[]>();
  const threads = new Map<number, ThreadContext>(),
    diagnostics: Diagnostic[] = [];
  const trivia = (start: number, end: number) => {
    let text = masked.slice(start, end);
    for (const c of comments.toReversed())
      if (c.start >= start && c.end <= end)
        text = text.slice(0, c.start - start) + " ".repeat(c.end - c.start) + text.slice(c.end - start);
    return text.trim() === "";
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
    // `@Capability("crypto", "filesystem")` states what the implementation needs.
    // The build rejects a module whose capabilities the app has not declared.
    if (name === "Capability" && fn && (fn.type === "FunctionDeclaration" || fn.type === "TSDeclareFunction")) {
      const names = [...(span.args ?? "").matchAll(/["']([A-Za-z][\w-]*)["']/g)].map((m) => m[1]!);
      const literals = (span.args ?? "").split(",").filter((part) => part.trim()).length;
      if (!names.length || names.length !== literals)
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
  return { threads, nativeOnly, sidecar, capabilities, diagnostics };
}
