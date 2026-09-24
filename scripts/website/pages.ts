import fs from "node:fs";
import path from "node:path";
import { runnerImport } from "vite";
import { docFile, type DocPage } from "../../apps/website/src/docs/types.ts";
import { docsEntries, findDoc } from "../../apps/website/src/docs/nav.ts";
import { docsRedirects } from "../../apps/website/src/docs/redirects.ts";
import type { docModules } from "./doc-modules.ts";
import { docsDir, websiteSrc, where } from "./context.ts";

/** Every page in reading order, with its blocks loaded from pages/<slug>.ts. */
export async function loadPages(): Promise<DocPage[]> {
  const { module } = await runnerImport<{ docModules: typeof docModules }>(path.join(import.meta.dirname, "doc-modules.ts"), {
    configFile: false,
    root: websiteSrc,
    logLevel: "error",
  });
  return docsEntries.map((entry) => {
    const page = module.docModules[docFile(entry.slug)];
    if (!page) throw new Error(`${where(entry.slug)} has no ${docFile(entry.slug)}`);
    return { ...entry, blocks: page.blocks };
  });
}

/** Page files match the nav, every page has its one "Next" link, and retired slugs redirect to pages that exist. */
export function checkStructure(pages: DocPage[]): string[] {
  const problems: string[] = [];
  const slugs = new Set(pages.map((p) => p.slug));
  const files = new Set(pages.map((p) => docFile(p.slug)));
  const pagesDir = path.join(docsDir, "pages");
  for (const file of fs.readdirSync(pagesDir, { recursive: true, encoding: "utf8" })) {
    const relative = `pages/${file.split(path.sep).join("/")}`;
    if (relative.endsWith(".ts") && !files.has(relative)) problems.push(`src/docs/${relative} is not in the nav (src/docs/nav.ts)`);
  }
  for (const page of pages) {
    if (page.next !== undefined && !slugs.has(page.next)) problems.push(`${where(page.slug)}: next is ${where(page.next)}, which is not a page`);
    if (!findDoc(page.slug)?.next) problems.push(`${where(page.slug)} has no "Next" link: set next in the nav`);
  }
  for (const [from, to] of Object.entries(docsRedirects)) {
    if (slugs.has(from)) problems.push(`redirect from ${where(from)} shadows a page`);
    if (!slugs.has(to)) problems.push(`redirect ${where(from)} → ${where(to)}: no such page`);
  }
  return problems;
}
