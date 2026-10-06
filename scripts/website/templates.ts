import type { DocTemplate } from "../../apps/website/src/docs/types.ts";

/** What a template module exports: one page, at its own path, or several pages by slug. */
export type TemplateModule = DocTemplate | { pages: Record<string, DocTemplate> };

/** A generated page, with the template (under src/docs/templates/) that writes it. */
export interface TemplatePage extends DocTemplate {
  file: string;
}

/** Every generated page by slug, from the template modules by file; two templates may not write one page. */
export function templatePages(
  modules: Record<string, TemplateModule>,
): Record<string, TemplatePage> {
  const out: Record<string, TemplatePage> = {};
  for (const [file, mod] of Object.entries(modules)) {
    const pages = "pages" in mod ? mod.pages : { [file.replace(/\.ts$/, "")]: mod };
    for (const [slug, { frontmatter, blocks }] of Object.entries(pages)) {
      const other = out[slug];
      if (other) throw new Error(`${slug} is written by both ${other.file} and ${file}`);
      out[slug] = { file, frontmatter, blocks };
    }
  }
  return out;
}
