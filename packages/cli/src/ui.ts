import { glyph as glyphOf, type GlyphName } from "./emoji.ts";
import { CliError } from "./errors.ts";
import type { IO } from "./io.ts";
import { createPalette, stripAnsi, type Palette } from "./style.ts";

export interface UIOptions {
  color: boolean;
  emoji: boolean;
  quiet: boolean;
  json: boolean;
}

/** The only writer commands use. Text goes to stdout (unless quiet or json), errors to stderr, JSON to stdout. */
export interface UI {
  readonly palette: Palette;
  readonly json: boolean;
  glyph(name: GlyphName): string;
  line(text?: string): void;
  /** Raw stdout for payloads (IR text), suppressed only by --json. */
  print(text: string): void;
  error(text: string): void;
  heading(name: GlyphName, text: string): void;
  step(name: GlyphName, text: string): void;
  ok(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
  hint(text: string): void;
  rows(rows: readonly (readonly string[])[]): void;
  data(value: unknown): void;
}

export function createUI(io: IO, options: UIOptions): UI {
  const palette = createPalette(options.color);
  const glyph = (name: GlyphName): string => glyphOf(name, options.emoji);
  const silent = options.quiet || options.json;
  const write = (text: string): void => {
    if (!silent) io.stdout.write(text + "\n");
  };
  return {
    palette,
    json: options.json,
    glyph,
    line: (text = "") => write(text),
    print: (text) => {
      if (!options.json) io.stdout.write(text.endsWith("\n") ? text : text + "\n");
    },
    error: (text) => io.stderr.write(text + "\n"),
    heading: (name, text) => write(`${glyph(name)} ${palette.bold(text)}`),
    step: (name, text) => write(`${glyph(name)} ${text}`),
    ok: (text) => write(`${glyph("ok")} ${text}`),
    warn: (text) => write(`${glyph("warn")} ${palette.yellow(text)}`),
    fail: (text) => write(`${glyph("fail")} ${palette.red(text)}`),
    hint: (text) => write(`${glyph("info")} ${palette.dim(text)}`),
    rows: (rows) => {
      for (const line of columns(rows)) write(line);
    },
    data: (value) => io.stdout.write(JSON.stringify(value, null, 2) + "\n"),
  };
}

/** Code points without ANSI codes or emoji variation selectors, so glyphs line up. */
const width = (text: string): number => [...stripAnsi(text).replaceAll("\uFE0F", "")].length;

/** Left-aligned columns. */
export function columns(rows: readonly (readonly string[])[], indent = "  "): string[] {
  const widths: number[] = [];
  for (const row of rows) for (const [i, cell] of row.entries()) widths[i] = Math.max(widths[i] ?? 0, width(cell));
  return rows.map((row) => {
    const cells = row.map((cell, i) => (i === row.length - 1 ? cell : cell + " ".repeat(widths[i]! - width(cell) + 2)));
    return (indent + cells.join("")).trimEnd();
  });
}

export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Renders any thrown error once, with its hint, and yields the exit code. */
export function reportError(error: unknown, ui: UI): number {
  const message = error instanceof Error ? error.message : String(error);
  ui.error(`${ui.glyph("fail")} ${ui.palette.red(message)}`);
  if (error instanceof CliError && error.hint) ui.error(`${ui.glyph("info")} ${ui.palette.dim(error.hint)}`);
  return error instanceof CliError ? error.exitCode : 1;
}
