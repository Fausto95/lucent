import { DIAGNOSTIC_CODES, type DiagnosticCode } from "@lucent-lang/compiler";
import { suggest } from "../args.ts";
import { CliError } from "../errors.ts";
import { DOCS_URL } from "../version.ts";
import { defineCommand } from "./types.ts";

interface Category {
  label: string;
  severity: "error" | "warning";
}

/** The first numeric character selects language, platform, or warning diagnostics. */
const CATEGORIES: Readonly<Record<string, Category>> = {
  "1": { label: "Language", severity: "error" },
  "2": { label: "Platform", severity: "error" },
  "3": { label: "Warning", severity: "warning" },
};

const DIAGNOSTICS_DOCS = `${DOCS_URL}/language.md#diagnostics`;

const isCode = (value: string): value is DiagnosticCode => value in DIAGNOSTIC_CODES;

const categoryOf = (code: string): Category =>
  CATEGORIES[code.charAt("LUCENT".length)] ?? { label: "Other", severity: "error" };

const entry = (code: DiagnosticCode): { code: string; title: string; category: string; severity: string } => ({
  code,
  title: DIAGNOSTIC_CODES[code],
  category: categoryOf(code).label.toLowerCase(),
  severity: categoryOf(code).severity,
});

export const explainCommand = defineCommand({
  name: "explain",
  glyph: "explain",
  summary: "Describe a diagnostic code, or list them all",
  usage: "[code]",
  options: {},
  examples: [
    { command: "lucent explain LUCENT1004", note: "What the code means and where to read more" },
    { command: "lucent explain", note: "Every code Lucent can report" },
  ],
  async run(ctx, _values, [input]) {
    const { ui } = ctx;
    const p = ui.palette;
    const codes = (Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[]).toSorted();
    if (input === undefined) {
      if (ui.json) {
        ui.data(codes.map(entry));
        return 0;
      }
      ui.heading("explain", "Lucent diagnostics");
      for (const [key, category] of Object.entries(CATEGORIES)) {
        ui.line();
        ui.line(p.bold(category.label));
        ui.rows(codes.filter((c) => c.charAt("LUCENT".length) === key).map((c) => [p.cyan(c), DIAGNOSTIC_CODES[c]]));
      }
      ui.line();
      ui.hint(DIAGNOSTICS_DOCS);
      return 0;
    }
    const code = input.toUpperCase();
    if (!isCode(code)) {
      const near = suggest(code, codes);
      throw new CliError(`Unknown diagnostic code "${input}".`, {
        hint: near ? `Did you mean "${near}"?` : "Run lucent explain to list every code.",
      });
    }
    if (ui.json) {
      ui.data(entry(code));
      return 0;
    }
    const category = categoryOf(code);
    ui.heading("explain", `${code} ${p.dim("·")} ${DIAGNOSTIC_CODES[code]}`);
    ui.line();
    ui.rows([
      [p.dim("Category"), `${category.label} ${p.dim(`(${category.severity})`)}`],
      [p.dim("Docs"), p.underline(DIAGNOSTICS_DOCS)],
    ]);
    return 0;
  },
});
