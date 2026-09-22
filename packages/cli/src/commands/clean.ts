import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defaultOutDir } from "../index.ts";
import { HOST_OPTION, resolveHost } from "./shared.ts";
import { defineCommand } from "./types.ts";

export const cleanCommand = defineCommand({
  name: "clean",
  glyph: "clean",
  summary: "Remove the build cache, IR dumps and the generated native package",
  usage: "[options]",
  options: {
    host: HOST_OPTION,
    out: { type: "string", placeholder: "<dir>", description: "Generated package directory, if you built with --out" },
    "dry-run": { type: "boolean", short: "n", description: "Show what would be removed without removing it" },
  },
  examples: [
    { command: "lucent clean", note: "Start the next build from scratch" },
    { command: "lucent clean --dry-run", note: "List what would be removed" },
  ],
  async run(ctx, values) {
    const { ui, root } = ctx;
    const p = ui.palette;
    const host = resolveHost(ctx, values.host);
    const dryRun = values["dry-run"] ?? false;
    const targets = [".lucent/cache.json", ".lucent/ir", values.out ?? defaultOutDir(host)].filter((t) =>
      existsSync(join(root, t)),
    );
    if (!dryRun) for (const target of targets) rmSync(join(root, target), { recursive: true, force: true });
    if (ui.json) {
      ui.data({ dryRun, targets });
      return 0;
    }
    if (!targets.length) {
      ui.ok("Nothing to clean.");
      return 0;
    }
    ui.heading("clean", `lucent clean ${dryRun ? p.dim("(dry run)") : ""}`.trimEnd());
    for (const target of targets) ui.step("clean", `${dryRun ? "would remove" : "removed"} ${p.cyan(target)}`);
    return 0;
  },
});
