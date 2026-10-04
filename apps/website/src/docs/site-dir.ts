/**
 * apps/website, wherever the code runs from: the repository's root (the
 * scripts, the tests) or the site's own directory (Docusaurus, which loads
 * its config as CommonJS, where import.meta isn't available).
 */
import fs from "node:fs";
import path from "node:path";

export function websiteDir(): string {
  const cwd = process.cwd();
  return fs.existsSync(path.join(cwd, "docusaurus.config.ts"))
    ? cwd
    : path.join(cwd, "apps/website");
}
