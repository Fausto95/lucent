import fs from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

/** The app's package manager, from its lockfile (in the app, or up the tree in a monorepo). */
export function packageManagerOf(
  root: string,
): { name: PackageManager; lockfile: string } | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const found = LOCKFILES.find(([f]) => fs.existsSync(path.join(dir, f)));
    if (found) return { name: found[1], lockfile: path.join(dir, found[0]) };
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** How the package manager runs a package's command: `npx lucent`, `pnpm exec lucent`, … */
export function runner(pm: PackageManager): string {
  return { npm: "npx", pnpm: "pnpm exec", yarn: "yarn", bun: "bunx" }[pm];
}
