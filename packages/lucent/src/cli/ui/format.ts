import type { Terminal } from "./terminal.ts";
import type { Theme } from "./theme.ts";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;

/** Columns a string takes on screen: without colour codes and link escapes. */
export function visibleWidth(s: string): number {
  return [...s.replace(ANSI, "")].length;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleWidth(s)));
}

/** 41 ms, 1.3 s, 1 m 5 s. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} m ${s % 60} s`;
}

/** Rows as lines, columns aligned by visible width. */
export function table(rows: string[][], gap = 2): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell))));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : pad(cell, widths[i]! + gap))).join(""));
}

/** An OSC 8 hyperlink where the terminal renders them, the text alone elsewhere. */
export function link(text: string, url: string, terminal: Terminal): string {
  return terminal.links ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}

export interface Span {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  length: number;
}

/**
 * The span's line with the lines around it, a gutter of line numbers, and
 * the span underlined. Long lines are cut around the span to fit the
 * terminal's width.
 */
export function codeFrame(source: string, span: Span, theme: Theme): string {
  const lines = source.split("\n");
  const first = Math.max(1, span.line - 1);
  const last = Math.min(lines.length, span.line + 1);
  const gutter = String(last).length;
  const { bar, ellipsis } = theme.symbols;
  const indent = "    ";
  const room = Math.max(20, theme.terminal.width - indent.length - gutter - 3);
  // One window for every line, so the underline stays under its span.
  const start = Math.max(0, Math.min(span.column - 1 - Math.floor(room / 3), (lines[span.line - 1] ?? "").length - room));
  const cut = (text: string) => {
    let s = text.slice(start, start + room);
    if (start > 0) s = ellipsis + s.slice(ellipsis.length);
    if (text.length > start + room) s = s.slice(0, room - ellipsis.length) + ellipsis;
    return s;
  };
  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    const text = (lines[n - 1] ?? "").replace(/\t/g, " ");
    if (n === last && text.trim() === "" && n !== span.line) continue;
    const num = String(n).padStart(gutter);
    out.push(`${indent}${n === span.line ? theme.bold(num) : theme.dim(num)} ${theme.dim(bar)} ${cut(text)}`);
    if (n === span.line) {
      const at = span.column - 1 - start;
      const width = Math.max(1, Math.min(span.length, room - at));
      out.push(`${indent}${" ".repeat(gutter)} ${theme.dim(bar)} ${" ".repeat(Math.max(0, at))}${theme.error("^".repeat(width))}`);
    }
  }
  return out.join("\n");
}
