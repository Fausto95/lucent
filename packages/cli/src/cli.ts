import { parseArgs } from "node:util";
import { parseCommandArgs, suggest } from "./args.ts";
import { COMMANDS, findCommand } from "./commands/index.ts";
import type { CommandContext } from "./commands/types.ts";
import { supportsEmoji } from "./emoji.ts";
import { CliError } from "./errors.ts";
import { GLOBAL_OPTIONS, renderCommandHelp, renderHelp, renderVersion, versionInfo } from "./help.ts";
import type { IO } from "./io.ts";
import { supportsColor } from "./style.ts";
import { createUI, reportError, type UI } from "./ui.ts";

interface Globals {
  help: boolean;
  version: boolean;
  json: boolean;
  quiet: boolean;
  color: boolean | undefined;
  emoji: boolean | undefined;
}

const GLOBAL_NODE_OPTIONS = Object.fromEntries(
  Object.entries(GLOBAL_OPTIONS).map(([name, spec]) => [
    name,
    { type: spec.type, ...("short" in spec ? { short: spec.short } : {}) },
  ]),
);

/** Lenient pre-scan so color, emoji and json are settled before anything, even a usage error, is printed. */
function scanGlobals(argv: readonly string[]): Globals {
  const { values } = parseArgs({
    args: [...argv],
    options: GLOBAL_NODE_OPTIONS,
    strict: false,
    allowPositionals: true,
    allowNegative: true,
  });
  const flag = (name: keyof typeof GLOBAL_OPTIONS): boolean | undefined =>
    typeof values[name] === "boolean" ? values[name] : undefined;
  return {
    help: flag("help") ?? false,
    version: flag("version") ?? false,
    json: flag("json") ?? false,
    quiet: flag("quiet") ?? false,
    color: flag("color"),
    emoji: flag("emoji"),
  };
}

/** The whole CLI: argv in, exit code out. Every failure is reported through one path. */
export async function run(argv: readonly string[], io: IO): Promise<number> {
  const globals = scanGlobals(argv);
  const ui = createUI(io, {
    color: supportsColor({
      env: io.env,
      isTTY: io.isTTY,
      ...(globals.color === undefined ? {} : { flag: globals.color }),
    }),
    emoji: supportsEmoji({ env: io.env, ...(globals.emoji === undefined ? {} : { flag: globals.emoji }) }),
    json: globals.json,
    quiet: globals.quiet,
  });
  try {
    return await dispatch(argv, io, ui, globals);
  } catch (error) {
    return reportError(error, ui);
  }
}

async function dispatch(argv: readonly string[], io: IO, ui: UI, globals: Globals): Promise<number> {
  let [name, ...rest] = argv;
  let help = globals.help;
  if (name === "help") {
    [name, ...rest] = rest;
    help = true;
  }
  if (name === undefined || name.startsWith("-")) {
    parseCommandArgs(
      GLOBAL_OPTIONS,
      argv.filter((a) => a !== "help"),
    );
    if (globals.version) {
      if (ui.json) ui.data(versionInfo());
      else ui.print(renderVersion(ui));
      return 0;
    }
    ui.print(renderHelp(COMMANDS, ui));
    return 0;
  }
  const command = findCommand(name);
  if (!command) {
    const near = suggest(
      name,
      COMMANDS.map((c) => c.name),
    );
    throw new CliError(`Unknown command "${name}".`, {
      hint: near ? `Did you mean "${near}"?` : "Run lucent --help to see the commands.",
    });
  }
  if (help) {
    ui.print(renderCommandHelp(command, ui));
    return 0;
  }
  const context: CommandContext = { root: io.cwd, io, ui };
  if (command.raw) return command.run(context, {}, rest);
  const { values, positionals } = parseCommandArgs({ ...GLOBAL_OPTIONS, ...command.options }, rest);
  return command.run(context, values, positionals);
}
