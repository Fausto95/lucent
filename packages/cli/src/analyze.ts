import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { compile, type Diagnostic, type IRModule } from "@lucent-lang/compiler";
import { renderDiagnostic } from "@lucent-lang/compiler";
import { loadLucentConfig, loadLucentSources, type LucentConfig } from "@lucent-lang/host-core";
import { positionOf } from "./diagnostics.ts";
import { CliError } from "./errors.ts";

/** One file through the compiler, with capability checks applied. Used by check, ir and doctor. */
export interface FileReport {
  file: string;
  source: string;
  module: IRModule | null;
  diagnostics: Diagnostic[];
  missingCapabilities: string[];
  /** Codeframes plus one plain entry per missing capability, in the compiler's text format. */
  rendered: string[];
}

export function loadConfig(root: string): LucentConfig {
  try {
    return loadLucentConfig(root);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), {
      hint: "Fix lucent.config.ts (or lucent.config.json) and run again.",
    });
  }
}

export function analyzeFile(root: string, file: string, config: LucentConfig): FileReport {
  const source = readFileSync(file, "utf8");
  const rel = relative(root, file);
  const result = compile(source, {
    fileName: file,
    sources: loadLucentSources(file, source),
    targets: config.targets,
    libraries: config.libraries,
  });
  const missingCapabilities = (result.module?.capabilities ?? []).filter((c) => !config.capabilities.includes(c));
  const rendered = result.diagnostics.map((d) => renderDiagnostic(d, source, rel));
  for (const capability of missingCapabilities)
    rendered.push(
      `error NT2001: Missing native capability\n\n${rel} needs the "${capability}" capability. Enable it in lucent.config.ts or lucent.config.json.`,
    );
  return { file: rel, source, module: result.module, diagnostics: result.diagnostics, missingCapabilities, rendered };
}

export const errorCount = (report: FileReport): number =>
  report.diagnostics.filter((d) => d.severity !== "warning").length +
  report.missingCapabilities.length +
  (report.module === null && !report.diagnostics.length ? 1 : 0);

export const warningCount = (report: FileReport): number =>
  report.diagnostics.filter((d) => d.severity === "warning").length;

export interface StructuredDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
  help?: string;
}

export function structuredDiagnostics(report: FileReport): StructuredDiagnostic[] {
  const own = report.diagnostics.map((d): StructuredDiagnostic => {
    const { line, column } = positionOf(d.span.origin?.source ?? report.source, d.span.start);
    return {
      code: d.code,
      severity: d.severity ?? "error",
      message: d.message,
      line,
      column,
      ...(d.help === undefined ? {} : { help: d.help }),
    };
  });
  const capabilities = report.missingCapabilities.map((capability): StructuredDiagnostic => ({
    code: "NT2001",
    severity: "error",
    message: `Missing capability "${capability}".`,
    line: 1,
    column: 1,
  }));
  return [...own, ...capabilities];
}
