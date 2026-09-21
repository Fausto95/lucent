import { DIAGNOSTIC_CODES, type DiagnosticCode } from "./codes.ts";

export { DIAGNOSTIC_CODES, type DiagnosticCode };

export interface Span {
  readonly origin?: { readonly fileName: string; readonly source: string };
  readonly start: number;
  readonly end: number;
}

export interface Diagnostic {
  readonly severity?: "error" | "warning";
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly span: Span;
  readonly help?: string;
}

export function diagnostic(code: DiagnosticCode, span: Span, message: string, help?: string): Diagnostic {
  return help === undefined ? { code, message, span } : { code, message, span, help };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity !== "warning");
}

/** Sorted (line start offsets) table used to map byte offsets to line/column. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function positionOf(starts: readonly number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

/** Renders a diagnostic in the Lucent codeframe format. */
export function renderDiagnostic(d: Diagnostic, source: string, fileName: string): string {
  source = d.span.origin?.source ?? source;
  fileName = d.span.origin?.fileName ?? fileName;
  const starts = lineStarts(source);
  const { line, column } = positionOf(starts, d.span.start);
  const lineEnd = starts[line] !== undefined ? starts[line]! - 1 : source.length;
  const text = source.slice(starts[line - 1]!, lineEnd).replace(/\r$/, "");
  const width = Math.max(1, Math.min(d.span.end, lineEnd) - d.span.start);
  const gutter = String(line);
  const pad = " ".repeat(gutter.length);
  const out = [
    `${d.severity ?? "error"} ${d.code}: ${DIAGNOSTIC_CODES[d.code]}`,
    "",
    `${d.message}`,
    "",
    `${pad} ┌─ ${fileName}:${line}:${column}`,
    `${gutter} │ ${text}`,
    `${pad} │ ${" ".repeat(column - 1)}${"^".repeat(width)}`,
  ];
  if (d.help) out.push("", d.help);
  return out.join("\n");
}
