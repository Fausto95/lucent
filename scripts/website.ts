/**
 * Keeps the website honest about the compiler and its own rules:
 *   1. regenerates apps/website/src/generated/: the data the reference
 *      templates read, and the snippets pages include (the homepage's C++,
 *      the example ports);
 *   2. writes the reference pages from their templates (src/docs/templates/)
 *      as MDX, and each page's "See the C++" (src/generated/cpp/<slug>.json);
 *   3. reads every docs page and blog post from its MDX and checks the
 *      docs' structure: page files match the sidebar, each slug sits under
 *      its section's directory, each page says its kind and has its "Next"
 *      link; and each post's date;
 *   4. compiles every `*.lucent.ts` sample on the docs pages and blog posts;
 *   5. checks internal links and their anchors, links into the docs from the
 *      repository (READMEs, docs/, the CLI's diagnostics URL),
 *      and each docs page's length budget (words and lines of code, by kind);
 *   6. writes each page's and post's prose as Markdown to apps/website/.prose/
 *      and runs Vale on it (apps/website/CONTRIBUTING-DOCS.md has the rules).
 *
 *   node scripts/website.ts           regenerate, then check
 *   node scripts/website.ts --check   fail if generated files are stale, or Vale is missing (CI)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { docsUrl, Explanations } from "../packages/compiler/src/index.ts";
import { pageToMdx } from "../apps/website/src/docs/mdx-write.ts";
import { root, website, docFile } from "./website/context.ts";
import { checkBudgets } from "./website/budget.ts";
import { generatedFiles } from "./website/generated.ts";
import { checkLinks, checkOutsideLinks } from "./website/links.ts";
import {
  checkedPages,
  checkPosts,
  checkStructure,
  loadPages,
  loadTemplates,
} from "./website/pages.ts";
import { checkProse } from "./website/prose.ts";
import { checkRedirects, vercelJson } from "./website/redirects.ts";
import { docsSlugs } from "../apps/website/src/docs/nav.ts";
import { checkSamples, unbuiltProblems } from "./website/samples.ts";

const check = process.argv.includes("--check");
const problems: string[] = [];

/** Writes a file under apps/website/, or with --check reports it as stale. */
function write(name: string, content: string): void {
  const file = path.join(website, name);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  if (check) problems.push(`apps/website/${name} is stale: run \`node scripts/website.ts\``);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

// Generated files first: templates read some, and pages include others.
const generated: Record<string, string> = Object.fromEntries(
  Object.entries(generatedFiles()).map(([name, content]) => [`src/generated/${name}`, content]),
);
for (const [name, content] of Object.entries(generated)) write(name, content);

// The JSON schemas, served where their $id says (https://lucent-lang.dev/schemas/…).
const schemasDir = path.join(root, "packages/lucent/schemas");
for (const name of fs.readdirSync(schemasDir))
  write(`static/schemas/${name}`, fs.readFileSync(path.join(schemasDir, name), "utf8"));

// The reference pages, from their templates.
const templates = await loadTemplates();
const pagesWritten: Record<string, string> = {};
for (const [slug, { file, frontmatter, blocks }] of Object.entries(templates)) {
  const name = docFile(slug);
  const template = `src/docs/templates/${file}`;
  // "Edit this page" opens the template: the page itself says not to edit it.
  const custom_edit_url = `https://github.com/Fausto95/lucent/edit/main/apps/website/${template}`;
  pagesWritten[name] = pageToMdx({ ...frontmatter, custom_edit_url }, blocks, {
    generatedFrom: template,
  });
  write(name, pagesWritten[name]!);
}

const { pages, posts } = loadPages(pagesWritten);
problems.push(...checkStructure(pages), ...checkPosts(posts));
const checked = checkedPages(pages, posts);
const samples = checkSamples(checked);
problems.push(...samples.problems);

/** A docs page's slug, from its URL. */
const slugOf = (href: string): string => href.slice("/docs/".length, -1);

// The C++ of each page's `cpp` samples, then stale files out.
for (const [href, cpp] of samples.cpp) {
  const name = `src/generated/cpp/${slugOf(href) || "index"}.json`;
  generated[name] = `${JSON.stringify(cpp, null, 2)}\n`;
  write(name, generated[name]!);
}
// Views compile where an iOS or Android SDK is; CI has the Android SDK, so there they must.
for (const href of samples.unchecked) {
  const unchecked = `${href}: its view samples are not checked here, without an iOS or Android SDK`;
  if (check) problems.push(unchecked);
  else console.warn(`! ${unchecked}`);
}
for (const [href, platforms] of samples.untyped)
  console.warn(
    `! ${href}: its view samples are not checked here, without the ${platforms.join(" and ")} SDK`,
  );
const cppFile = (href: string) => `src/generated/cpp/${slugOf(href) || "index"}.json`;
const unbuilt = new Set([...samples.unbuilt.keys()].map(cppFile));
for (const [href, { platforms }] of samples.unbuilt)
  console.warn(
    `! ${href}: its C++ is not rebuilt here, without the ${platforms.join(" and ")} SDK`,
  );
problems.push(
  ...unbuiltProblems(samples.unbuilt, (href) => {
    const file = path.join(website, cppFile(href));
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
  }),
);
const generatedDir = path.join(website, "src/generated");
const existing = fs
  .readdirSync(generatedDir, { recursive: true, encoding: "utf8" })
  .filter((f) => fs.statSync(path.join(generatedDir, f)).isFile())
  .map((f) => `src/generated/${f.split(path.sep).join("/")}`);
for (const name of existing.filter((f) => !(f in generated) && !unbuilt.has(f))) {
  if (check) problems.push(`apps/website/${name} is stale: run \`node scripts/website.ts\``);
  else fs.rmSync(path.join(website, name));
}

problems.push(...checkLinks(checked));

// The old URLs redirect to pages that exist, through vercel.json (src/docs/redirects.ts).
problems.push(...checkRedirects(docsSlugs));
const vercelFile = path.join(root, "vercel.json");
const vercel = vercelJson(fs.readFileSync(vercelFile, "utf8"));
if (fs.readFileSync(vercelFile, "utf8") !== vercel) {
  if (check) problems.push("vercel.json is stale: run `node scripts/website.ts`");
  else fs.writeFileSync(vercelFile, vercel);
}

// Links into the docs from outside its pages: they name pages as they are now.
// The homepage's go through Docusaurus' <Link>, which the site's build checks.
const tracked = spawnSync("git", ["ls-files", "--", "docs"], { cwd: root, encoding: "utf8" });
const outside = [
  "apps/website/src/docs/comparison-table.ts",
  "apps/website/README.md",
  "apps/website/CONTRIBUTING-DOCS.md",
  "README.md",
  "packages/lucent/README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "ROADMAP.md",
  // Tracked only: docs/ also holds local planning files that git ignores.
  ...tracked.stdout.split("\n").filter((f) => f.endsWith(".md")),
];
problems.push(
  ...checkOutsideLinks(
    [
      ...outside.map((name) => ({ name, text: fs.readFileSync(path.join(root, name), "utf8") })),
      // The URL `lucent explain` and the editor print for each diagnostic.
      {
        name: "docsUrl() in packages/compiler/src/codes.ts",
        text: Object.keys(Explanations).map(docsUrl).join("\n"),
      },
    ],
    checked,
  ),
);
problems.push(...checkBudgets(checked));
const prose = checkProse(checked, check);
problems.push(...prose.problems);

for (const warning of prose.warnings) console.warn(`! ${warning}`);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `✓ website: ${pages.length} pages, ${posts.length} blog post${posts.length === 1 ? "" : "s"}, ${samples.checked} Lucent samples compile, links resolve, ${prose.ran ? "prose checked" : "prose not checked"}, generated files ${check ? "up to date" : "written"}`,
);
