import { existsSync } from "node:fs";
import { join } from "node:path";
import { printIR } from "@lucent-lang/compiler";
import { analyzeFile, errorCount, loadConfig, structuredDiagnostics } from "../analyze.ts";
import { colorizeDiagnostic } from "../diagnostics.ts";
import { CliError } from "../errors.ts";
import { defineCommand } from "./types.ts";

export const irCommand = defineCommand({
  name: "ir",
  glyph: "ir",
  summary: "Print the typed intermediate representation of a Lucent file",
  usage: "<file>",
  options: {},
  examples: [
    { command: "lucent ir src/geo.lucent.ts", note: "The IR as text" },
    { command: "lucent ir src/geo.lucent.ts --json", note: "The IR module as JSON" },
  ],
  async run(ctx, _values, [file]) {
    const { ui, root } = ctx;
    if (!file) throw new CliError("Pass the Lucent file to print.", { hint: "lucent ir src/geo.lucent.ts" });
    const path = file.startsWith("/") ? file : join(root, file);
    if (!existsSync(path)) throw new CliError(`No such file: ${file}`);
    const report = analyzeFile(root, path, loadConfig(root));
    if (!report.module || errorCount(report)) {
      if (ui.json) ui.data({ ok: false, file: report.file, diagnostics: structuredDiagnostics(report) });
      else for (const text of report.rendered) ui.error(colorizeDiagnostic(text, ui.palette) + "\n");
      return 1;
    }
    if (ui.json) {
      ui.data(report.module);
      return 0;
    }
    ui.heading("ir", `${report.file} ${ui.palette.dim(`→ module ${report.module.name}`)}`);
    ui.line();
    ui.print(printIR(report.module));
    return 0;
  },
});
