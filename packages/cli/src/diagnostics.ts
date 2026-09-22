import type { Palette, Style } from "./style.ts";

type Rule = { pattern: RegExp; paint: (match: RegExpExecArray, p: Palette, accent: Style) => string };

/** Line-shaped rules over the compiler's plain codeframe. The compiler itself stays color-free. */
const RULES: readonly Rule[] = [
  {
    pattern: /^(error|warning)( NT\d{4}:)(.*)$/,
    paint: (m, p) => `${(m[1] === "error" ? p.red : p.yellow)(m[1]!)}${p.bold(m[2]!)}${m[3]!}`,
  },
  { pattern: /^(\s*┌─ )(.+)$/, paint: (m, p) => `${p.dim(m[1]!)}${p.cyan(m[2]!)}` },
  {
    pattern: /^(\s*\d*\s│ )(\s*)(\^+)(.*)$/,
    paint: (m, p, accent) => `${p.dim(m[1]!)}${m[2]!}${accent(m[3]!)}${m[4]!}`,
  },
  { pattern: /^(\s*\d*\s│ )(.*)$/, paint: (m, p) => `${p.dim(m[1]!)}${m[2]!}` },
];

export function colorizeDiagnostic(rendered: string, palette: Palette): string {
  const accent = rendered.startsWith("warning") ? palette.yellow : palette.red;
  return rendered
    .split("\n")
    .map((line) => {
      for (const rule of RULES) {
        const match = rule.pattern.exec(line);
        if (match) return rule.paint(match, palette, accent);
      }
      return line;
    })
    .join("\n");
}

/** 1-based line and column of a byte offset. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++)
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  return { line, column: offset - lineStart + 1 };
}
