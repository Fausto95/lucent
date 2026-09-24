import { describe, expect, it } from "vitest";
import { type CommandSpec, parseArgs } from "../src/cli/args.ts";
import { commandHelp, help } from "../src/cli/help.ts";
import { commands } from "../src/cli/commands.ts";
import { createTheme } from "../src/cli/ui/theme.ts";
import { visibleWidth } from "../src/cli/ui/format.ts";

const noop = async () => ({ run: () => 0 });
const specs: CommandSpec[] = [
  { name: "build", summary: "Build", flags: [{ name: "force", description: "Rebuild" }, { name: "platforms", value: "list", description: "Targets" }], load: noop },
  { name: "sdk prefetch", summary: "Prefetch", flags: [{ name: "ios", value: "modules", description: "iOS modules" }], load: noop },
];

describe("parseArgs", () => {
  it("finds the command, its flags and positionals", () => {
    const r = parseArgs(["build", "--force", "--platforms", "ios,android", "extra"], specs);
    expect(r).toMatchObject({ command: { name: "build" }, flags: { force: true, platforms: "ios,android" }, positionals: ["extra"] });
  });

  it("matches commands of two words", () => {
    expect(parseArgs(["sdk", "prefetch", "--ios", "UIKit"], specs)).toMatchObject({ command: { name: "sdk prefetch" }, flags: { ios: "UIKit" } });
  });

  it("accepts --flag=value and the global flags", () => {
    expect(parseArgs(["build", "--platforms=ios", "--json", "--root", "/app"], specs)).toMatchObject({ flags: { platforms: "ios", json: true, root: "/app" } });
  });

  it("reports unknown flags and missing values with the command", () => {
    expect(parseArgs(["build", "--nope"], specs)).toEqual({ error: "unknown flag --nope for lucent build" });
    expect(parseArgs(["build", "--platforms"], specs)).toEqual({ error: "--platforms needs a value (--platforms <list>)" });
  });

  it("reports unknown commands, suggesting the closest", () => {
    expect(parseArgs(["biuld"], specs)).toEqual({ error: "unknown command biuld (did you mean build?)" });
  });

  it("leaves a bare invocation and --help to the caller", () => {
    expect(parseArgs([], specs)).toMatchObject({ command: undefined, flags: {} });
    expect(parseArgs(["build", "--help"], specs)).toMatchObject({ command: { name: "build" }, flags: { help: true } });
  });
});

describe("help", () => {
  const theme = createTheme({ color: false, unicode: true, interactive: false, links: false, width: 80 });

  it("lists every command from the command table", () => {
    const text = help(commands, theme);
    for (const c of commands) expect(text).toContain(`lucent ${c.name}`);
  });

  it("fits 80 columns", () => {
    for (const text of [help(commands, theme), ...commands.map((c) => commandHelp(c, theme))]) {
      for (const line of text.split("\n")) expect(visibleWidth(line), line).toBeLessThanOrEqual(80);
    }
  });

  it("describes a command's flags", () => {
    expect(commandHelp(specs[0]!, theme)).toMatchSnapshot();
  });
});
