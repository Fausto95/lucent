import path from "node:path";
import { parseArgs } from "./args.ts";
import { commands } from "./commands.ts";
import { installCrashHandler } from "./crash.ts";
import { commandHelp, help } from "./help.ts";
import { createOutput } from "./output.ts";
import { version } from "./version.ts";

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, commands);
  const out = createOutput("error" in parsed ? false : !!parsed.flags.json);
  if ("error" in parsed) {
    out.error(`${out.theme.error(out.theme.symbols.fail)} ${parsed.error}`);
    out.error(out.theme.dim("Run lucent --help for the commands and their flags."));
    return 2;
  }
  const { command, flags, positionals } = parsed;
  if (flags.version && !command) {
    out.print(`lucent ${version()}`);
    return 0;
  }
  if (!command) {
    out.print(help(commands, out.theme));
    return flags.help ? 0 : 1;
  }
  if (flags.help) {
    out.print(commandHelp(command, out.theme));
    return 0;
  }
  const root = path.resolve(typeof flags.root === "string" ? flags.root : process.cwd());
  const module = await command.load();
  return module.run({ root, flags, positionals, out });
}

installCrashHandler(version());
const status = await main(process.argv.slice(2));
// Watch mode keeps running.
if (status >= 0) process.exit(status);
