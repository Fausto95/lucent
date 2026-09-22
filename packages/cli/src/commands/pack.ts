import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "./types.ts";

interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: { access?: string };
}

/**
 * Dry-run publish helper: lists workspace packages that look publishable and
 * prints the manual publish steps. Does not call the registry.
 */
export const packCommand = defineCommand({
  name: "pack",
  glyph: "cached",
  summary: "List publishable packages and print release pack steps",
  usage: "",
  options: {},
  examples: [
    { command: "lucent pack", note: "Show which @lucent-lang packages can be packed" },
    { command: "lucent pack --json", note: "Machine-readable package list" },
  ],
  async run(ctx) {
    const { ui, root } = ctx;
    const packagesDir = join(root, "packages");
    if (!existsSync(packagesDir)) {
      ui.error("No packages/ directory at the project root.");
      return 1;
    }
    const publishable: { name: string; version: string; path: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(packagesDir, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      const name = manifest.name ?? entry.name;
      if (manifest.private === true) {
        skipped.push({ name, reason: "private" });
        continue;
      }
      if (!manifest.publishConfig) {
        skipped.push({ name, reason: "missing publishConfig" });
        continue;
      }
      publishable.push({
        name,
        version: manifest.version ?? "0.0.0",
        path: `packages/${entry.name}`,
      });
    }
    publishable.sort((a, b) => a.name.localeCompare(b.name));
    if (ui.json) {
      ui.data({ ok: true, publishable, skipped });
      return 0;
    }
    ui.heading("cached", "lucent pack");
    ui.line();
    if (!publishable.length) {
      ui.warn("No publishable packages found (need non-private + publishConfig).");
    } else {
      ui.line(ui.palette.bold("Publishable:"));
      for (const pkg of publishable) {
        ui.line(`  ${pkg.name}@${pkg.version}  ${ui.palette.dim(pkg.path)}`);
      }
    }
    if (skipped.length) {
      ui.line();
      ui.line(ui.palette.dim(`Skipped (${skipped.length}): private or missing publishConfig`));
    }
    ui.line();
    ui.heading("book", "publish steps");
    ui.line("1. Green typecheck / test / verify on the release commit");
    ui.line("2. pnpm -r pack --dry-run   # or pack individual packages");
    ui.line("3. Attach P90 evidence; see docs/release.md and docs/P90-checklist.md");
    ui.line("4. pnpm publish -r --access public   # only when intentionally releasing");
    ui.line();
    ui.hint("Fresh-install smoke: scripts/smoke-fresh-install.md");
    return 0;
  },
});
