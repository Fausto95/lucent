/**
 * Keeps the website honest about the compiler and its own rules:
 *   1. regenerates apps/website/src/generated/: the homepage's C++ sample,
 *      the CLI and diagnostics references, and the docs route tree;
 *   2. checks the docs' structure: page files match the nav, each page has
 *      its "Next" link, retired slugs redirect to pages that exist;
 *   3. compiles every `*.lucent.ts` sample on the docs pages;
 *   4. checks internal links and their anchors;
 *   5. writes each page's prose as Markdown to apps/website/.prose/ and runs
 *      Vale on it (apps/website/CONTRIBUTING-DOCS.md has the rules).
 *
 *   tsx scripts/website.ts           regenerate, then check
 *   tsx scripts/website.ts --check   fail if generated files are stale, or Vale is missing (CI)
 */
import fs from "node:fs";
import path from "node:path";
import { websiteSrc } from "./website/context.ts";
import { generatedFiles } from "./website/generated.ts";
import { checkLinks } from "./website/links.ts";
import { checkStructure, loadPages } from "./website/pages.ts";
import { checkProse } from "./website/prose.ts";
import { checkSamples } from "./website/samples.ts";

const check = process.argv.includes("--check");
const problems: string[] = [];

const generatedDir = path.join(websiteSrc, "generated");
fs.mkdirSync(generatedDir, { recursive: true });
for (const [name, content] of Object.entries(generatedFiles())) {
  const file = path.join(generatedDir, name);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) continue;
  if (check) problems.push(`apps/website/src/generated/${name} is stale: run \`pnpm exec tsx scripts/website.ts\``);
  else fs.writeFileSync(file, content);
}

const pages = await loadPages();
problems.push(...checkStructure(pages));
const samples = checkSamples(pages);
problems.push(...samples.problems);
problems.push(...checkLinks(pages));
const prose = checkProse(pages, check);
problems.push(...prose.problems);

for (const warning of prose.warnings) console.warn(`! ${warning}`);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `✓ website: ${pages.length} pages, ${samples.checked} Lucent samples compile, links resolve, ${prose.ran ? "prose checked" : "prose not checked"}, generated files ${check ? "up to date" : "written"}`,
);
