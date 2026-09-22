import { COMPILER_VERSION } from "@lucent-lang/compiler";
import type { OptionSpecs } from "./args.ts";
import type { Command } from "./commands/types.ts";
import { columns, type UI } from "./ui.ts";
import { CLI_VERSION, DOCS_URL } from "./version.ts";

export const GLOBAL_OPTIONS = {
  help: { type: "boolean", short: "h", description: "Show help" },
  version: { type: "boolean", short: "v", description: "Show the CLI and compiler versions" },
  json: { type: "boolean", description: "Machine-readable output, where a command supports it" },
  quiet: { type: "boolean", short: "q", description: "Only print errors" },
  color: {
    type: "boolean",
    description: "Force color on (--no-color to disable; NO_COLOR and FORCE_COLOR are honored)",
  },
  emoji: { type: "boolean", description: "Force emoji on (--no-emoji to disable; NO_EMOJI is honored)" },
} as const satisfies OptionSpecs;

const TAGLINE = "write native React Native modules in TypeScript";

function optionRows(specs: OptionSpecs, ui: UI): string[][] {
  const p = ui.palette;
  return Object.entries(specs).map(([name, spec]) => {
    const long = spec.type === "boolean" && spec.default === true ? `--no-${name}` : `--${name}`;
    const flag = [spec.short ? `-${spec.short}` : undefined, spec.placeholder ? `${long} ${spec.placeholder}` : long]
      .filter((f) => f !== undefined)
      .join(", ");
    const extra = spec.values
      ? p.dim(` (${spec.values.join(" | ")})`)
      : typeof spec.default === "string"
        ? p.dim(` [default: ${spec.default}]`)
        : "";
    return [p.cyan(flag), spec.description + extra];
  });
}

export function renderHelp(commands: readonly Command[], ui: UI): string {
  const p = ui.palette;
  return [
    `${ui.glyph("sparkles")} ${p.bold(`lucent ${CLI_VERSION}`)} ${p.dim("—")} ${TAGLINE}`,
    "",
    p.bold("Usage"),
    `  lucent ${p.cyan("<command>")} [options]`,
    "",
    p.bold("Commands"),
    ...columns(commands.map((c) => [`${ui.glyph(c.glyph)} ${p.cyan(c.name)}`, c.summary])),
    "",
    p.bold("Options"),
    ...columns(optionRows(GLOBAL_OPTIONS, ui)),
    "",
    `Run ${p.cyan("lucent <command> --help")} for a command's options and examples.`,
    `${ui.glyph("book")} ${p.dim(`${DOCS_URL}/getting-started.md`)}`,
  ].join("\n");
}

export function renderCommandHelp(command: Command, ui: UI): string {
  const p = ui.palette;
  const own = Object.keys(command.options).length
    ? [p.bold("Options"), ...columns(optionRows(command.options, ui)), ""]
    : [];
  return [
    `${ui.glyph(command.glyph)} ${p.bold(`lucent ${command.name}`)} ${p.dim("—")} ${command.summary}`,
    "",
    p.bold("Usage"),
    `  lucent ${command.name} ${command.usage}`,
    "",
    ...own,
    p.bold("Global options"),
    ...columns(optionRows(GLOBAL_OPTIONS, ui)),
    "",
    p.bold("Examples"),
    ...columns(command.examples.map((e) => [p.cyan(e.command), p.dim(e.note)])),
  ].join("\n");
}

export const versionInfo = (): { cli: string; compiler: string; node: string } => ({
  cli: CLI_VERSION,
  compiler: COMPILER_VERSION,
  node: process.version,
});

export function renderVersion(ui: UI): string {
  const p = ui.palette;
  return `${ui.glyph("sparkles")} lucent ${p.bold(CLI_VERSION)} ${p.dim("·")} compiler ${COMPILER_VERSION} ${p.dim(`· node ${process.version}`)}`;
}
