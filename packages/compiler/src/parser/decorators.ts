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
export function maskDecorators(source: string): { source: string; decorators: Span[] } {
  const decorators: Span[] = [],
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
        const end = i + name[0].length;
        decorators.push({ start: i, end });
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
  source: string,
  masked: string,
  body: ES.Statement[],
  decorators: Span[],
  comments: readonly { start: number; end: number }[],
) {
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
    const context = CONTEXTS[source.slice(span.start + 1, span.end)];
    if (
      !context ||
      !fn ||
      (fn.type !== "FunctionDeclaration" && fn.type !== "TSDeclareFunction") ||
      threads.has(fn.start)
    )
      diagnostics.push(
        diagnostic("LC1001", span, "Use exactly one of @MainThread, @Background, or @Inherited before a function."),
      );
    else threads.set(fn.start, context);
  }
  return { threads, diagnostics };
}
