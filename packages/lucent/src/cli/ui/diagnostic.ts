import { codeFrame, link } from "./format.ts";
import type { Theme } from "./theme.ts";

/** What the CLI renders of a diagnostic (the compiler's Diagnostic has these fields). */
export interface DiagnosticLike {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  length?: number;
  fix?: string;
  docs?: string;
}

/** Wraps `text` at `width` columns, indenting continuation lines by `indent`. */
function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.join(`\n${indent}`);
}

/**
 * One problem, as `lucent check` and `lucent build` print it:
 *
 *   error LUCENT3006  UIApplication.shared is main-thread only
 *
 *     share.ios.lucent.ts:12:17
 *     11 │ …
 *     12 │   const app = UIApplication.shared;
 *        │               ^^^^^^^^^^^^^^^^^^^^
 *
 *   fix  wrap the call in main(() => …)
 *   docs lucent explain LUCENT3006
 *
 * `file` is shown as given (callers make it relative); `source` is the
 * file's text, for the frame.
 */
export function renderDiagnostic(d: DiagnosticLike, source: string | undefined, theme: Theme): string {
  const width = theme.terminal.width;
  const head = `  ${theme.error("error")} ${theme.bold(d.code)}  `;
  const out = [`${head}${wrap(d.message.split("\n").join(" "), Math.max(20, width - 2 - 6 - d.code.length - 2), " ".repeat(6 + d.code.length + 4))}`];
  if (d.file) {
    out.push("", `    ${theme.dim(d.line ? `${d.file}:${d.line}:${d.column ?? 1}` : d.file)}`);
    if (source !== undefined && d.line) out.push(codeFrame(source, { line: d.line, column: d.column ?? 1, length: d.length ?? 1 }, theme));
  }
  if (d.fix || d.docs) out.push("");
  if (d.fix) out.push(`  ${theme.success("fix")}  ${wrap(d.fix, Math.max(20, width - 7), "       ")}`);
  if (d.docs) out.push(`  ${theme.progress("docs")} lucent explain ${link(d.code, d.docs, theme.terminal)}`);
  return out.join("\n");
}
