/**
 * The CLI tests run bin/lucent.cjs, which runs the bundle in dist/, so the
 * run starts from a current build. vp run caches it: with no changes since
 * the last build this replays in well under a second.
 */
import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("pnpm", ["exec", "vp", "run", "@lucent-lang/lucent#build"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}
