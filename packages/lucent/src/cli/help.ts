import { type CommandSpec, type FlagSpec, GLOBAL_FLAGS } from "./args.ts";
import type { Theme } from "./ui/theme.ts";

const flagLabel = (f: FlagSpec) => `--${f.name}${f.value ? (f.optional ? ` [<${f.value}>]` : ` <${f.value}>`) : ""}`;

/** Wraps `text` to `width` columns. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...out, line] : out;
}

/** Rows of `label  description`, descriptions wrapped under their column. */
function described(rows: [string, string][], theme: Theme): string[] {
  const labelWidth = Math.min(34, Math.max(...rows.map(([l]) => l.length)));
  const room = Math.max(20, theme.terminal.width - 2 - labelWidth - 2);
  return rows.flatMap(([label, text]) => {
    const lines = wrap(text, room);
    if (label.length > labelWidth) return [`  ${label}`, ...lines.map((l) => `  ${" ".repeat(labelWidth + 2)}${theme.dim(l)}`)];
    return lines.map((l, i) => `  ${(i ? "" : label).padEnd(labelWidth + 2)}${theme.dim(l)}`);
  });
}

export function help(commands: CommandSpec[], theme: Theme): string {
  return [
    `${theme.brand(theme.symbols.brand)} ${theme.bold("lucent")}  ${theme.dim("native React Native modules in TypeScript")}`,
    "",
    theme.bold("Usage"),
    "  lucent <command> [flags]",
    "",
    theme.bold("Commands"),
    ...described(commands.map((c) => [`lucent ${c.name}`, c.summary]), theme),
    "",
    theme.bold("Flags"),
    ...described([...GLOBAL_FLAGS.map((f): [string, string] => [flagLabel(f), f.description]), ["--version", "Show the version"]], theme),
    "",
    theme.dim("Run lucent <command> --help for a command's flags."),
  ].join("\n");
}

export function commandHelp(command: CommandSpec, theme: Theme): string {
  const flags = [...command.flags, ...GLOBAL_FLAGS];
  return [
    theme.bold(`lucent ${command.name}`),
    ...wrap(command.summary, theme.terminal.width - 2).map((l) => `  ${theme.dim(l)}`),
    "",
    theme.bold("Flags"),
    ...described(flags.map((f) => [flagLabel(f), f.description]), theme),
  ].join("\n");
}
