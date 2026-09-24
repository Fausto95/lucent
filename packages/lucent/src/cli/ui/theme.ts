import pc from "picocolors";
import type { Terminal } from "./terminal.ts";

export interface Symbols {
  brand: string;
  ok: string;
  fail: string;
  warn: string;
  busy: string;
  on: string;
  off: string;
  bar: string;
  rule: string;
  ellipsis: string;
}

const UNICODE: Symbols = { brand: "◆", ok: "✓", fail: "✗", warn: "!", busy: "◐", on: "●", off: "○", bar: "│", rule: "─", ellipsis: "…" };
const ASCII: Symbols = { brand: "*", ok: "+", fail: "x", warn: "!", busy: "~", on: "o", off: ".", bar: "|", rule: "-", ellipsis: "..." };

type Paint = (s: string) => string;

/** The CLI's colour tokens and symbols, for one terminal. */
export interface Theme {
  terminal: Terminal;
  symbols: Symbols;
  brand: Paint;
  success: Paint;
  error: Paint;
  warn: Paint;
  progress: Paint;
  dim: Paint;
  bold: Paint;
}

export function createTheme(terminal: Terminal): Theme {
  const c = pc.createColors(terminal.color);
  // Violet: 256-colour 141, where picocolors has only the 16 base colours.
  const violet: Paint = terminal.color ? (s) => `\x1b[38;5;141m${s}\x1b[39m` : (s) => s;
  return {
    terminal,
    symbols: terminal.unicode ? UNICODE : ASCII,
    brand: violet,
    success: c.green,
    error: c.red,
    warn: c.yellow,
    progress: c.cyan,
    dim: c.dim,
    bold: c.bold,
  };
}
