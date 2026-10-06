import fs from "node:fs";
import path from "node:path";
import { runnerImport } from "vite";
import { readMdx } from "../../apps/website/src/docs/mdx-read.ts";
import type { PostEntry } from "../../apps/website/src/blog/types.ts";
import {
  type DocSection,
  INTERNALS,
  docId,
  docsSections,
  docsSlugs,
  locate,
  slugsOf,
} from "../../apps/website/src/docs/nav.ts";
import {
  type Block,
  DOC_KINDS,
  type DocFrontmatter,
  type DocKind,
  type DocPage,
  docsHref,
} from "../../apps/website/src/docs/types.ts";
import type { templateModules } from "./doc-modules.ts";
import { type TemplatePage, templatePages } from "./templates.ts";
import { blogContent, docFile, docsContent, website, websiteSrc, where } from "./context.ts";

/**
 * What the checks read of a page, a docs page or a blog post: its samples
 * compile, its links resolve, its prose follows the rules.
 */
export interface CheckedPage {
  /** Its URL, as problems name it: /docs/<slug>/ or /blog/<slug>/. */
  href: string;
  /** A docs page's kind sets its length budget; a post has none. */
  kind: DocKind | "post";
  title: string;
  /** A docs page's description, a post's too. */
  description: string;
  blocks: Block[];
  /** Its samples include components drawn with SwiftUI and Compose: they compile with views. */
  views?: true;
}

export interface Post extends PostEntry {
  blocks: Block[];
}

/** The generated pages, by slug, each with the template (src/docs/templates/) that writes it. */
export async function loadTemplates(): Promise<Record<string, TemplatePage>> {
  const { module } = await runnerImport<{ templateModules: typeof templateModules }>(
    path.join(import.meta.dirname, "doc-modules.ts"),
    { configFile: false, root: websiteSrc, logLevel: "error" },
  );
  return templatePages(module.templateModules);
}

/** The `.mdx` files under `dir`, relative to it, with forward slashes; none when it doesn't exist. */
function mdxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith(".mdx"));
}

/** A page's frontmatter and blocks; a problem names the file. */
function read(source: string, file: string) {
  try {
    return readMdx(source);
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Every docs page in sidebar order, and every post newest first, read from
 * their MDX. `written` overrides a page's file content (a template's page the
 * run is about to write), by its file.
 */
export function loadPages(written: Record<string, string> = {}): {
  pages: DocPage[];
  posts: Post[];
} {
  const pages = docsSlugs.flatMap((slug): DocPage[] => {
    const file = path.join(website, docFile(slug));
    const source =
      written[docFile(slug)] ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
    if (source === undefined) return [];
    const { frontmatter, blocks } = read(source, docFile(slug));
    return [{ ...(frontmatter as unknown as DocFrontmatter), slug, blocks }];
  });

  const posts = mdxFiles(blogContent)
    .map((file): Post => {
      const source = fs.readFileSync(path.join(blogContent, file), "utf8");
      const { frontmatter, blocks } = read(source, `src/content/blog/${file}`);
      return { ...(frontmatter as unknown as PostEntry), slug: file.replace(/\.mdx$/, ""), blocks };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return { pages, posts };
}

/** Docs pages and posts, as the checks read them. */
export function checkedPages(pages: DocPage[], posts: Post[]): CheckedPage[] {
  return [
    ...pages.map((p) => ({ ...p, href: docsHref(p.slug) })),
    ...posts.map((p) => ({
      href: `/blog/${p.slug}/`,
      kind: "post" as const,
      title: p.title,
      description: p.description,
      blocks: p.blocks,
      ...(p.views ? { views: p.views } : {}),
    })),
  ];
}

const KINDS = new Set(Object.keys(DOC_KINDS));

/** Page files match the sidebar (src/docs/nav.ts), which follows checkNav's slug scheme, and each page follows checkPages' rules. */
export function checkStructure(pages: DocPage[]): string[] {
  const problems: string[] = [];
  const slugs = new Set(pages.map((p) => p.slug));
  const listed = new Set(docsSlugs);
  for (const file of mdxFiles(docsContent)) {
    const slug = file === "index.mdx" ? "" : file.replace(/\.mdx$/, "");
    if (!listed.has(slug))
      problems.push(`src/content/docs/docs/${file} is not in the sidebar (src/docs/nav.ts)`);
  }
  for (const slug of docsSlugs)
    if (!slugs.has(slug)) problems.push(`${where(slug)} has no ${docFile(slug)}`);
  const dups = docsSlugs.filter((s, i) => docsSlugs.indexOf(s) !== i);
  for (const dup of new Set(dups)) problems.push(`${where(dup)} is in the sidebar twice`);
  return [...problems, ...checkNav(), ...checkPages(pages)];
}

/**
 * The slug scheme: each page under its section's directory, the docs home
 * ("") first and only there, a landing page x next to x/ (never x/index, which
 * Docusaurus would serve at x/), no empty section, group or sub-group, and
 * each group's label once in its section.
 */
export function checkNav(sections: DocSection[] = docsSections): string[] {
  const problems: string[] = [];
  if (slugsOf(sections).some((slug, i) => slug === "" && i > 0))
    problems.push(`${where("")} is the first page of the first section, and only there`);

  for (const section of sections) {
    if (!section.groups.length) problems.push(`${section.label} has no group`);

    const labels = section.groups.map((g) => g.label);
    for (const label of new Set(labels.filter((l, i) => labels.indexOf(l) !== i)))
      problems.push(`${section.label} has two groups labelled ${label}`);

    for (const group of section.groups) {
      const at = `${section.label} › ${group.label}`;
      if (!group.items.length) problems.push(`${at} has no page`);
      for (const item of group.items)
        if (typeof item !== "string" && !item.slugs.length)
          problems.push(`${at} › ${item.label} has no page`);
    }

    for (const slug of slugsOf([section])) {
      if (slug === "") continue;
      if (slug !== section.dir && !slug.startsWith(`${section.dir}/`))
        problems.push(
          `${where(slug)} is listed in ${section.label}: its slug starts with ${section.dir}/`,
        );
      if (slug.endsWith("/index")) {
        const landing = slug.slice(0, -"/index".length);
        problems.push(
          `${where(slug)}: a landing page is ${landing} (its file ${landing}.mdx), not ${slug}`,
        );
      }
    }
  }
  return problems;
}

/** Whether a slug is one of Architecture's contributor pages. */
const internal = (slug: string): boolean => slug === INTERNALS || slug.startsWith(`${INTERNALS}/`);

/**
 * Each page says its kind, internals pages and only those are under
 * Architecture's Internals, pages about views are marked experimental, and
 * a frontmatter pagination_next names a doc of the same section.
 */
export function checkPages(pages: DocPage[], sections: DocSection[] = docsSections): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    const at = where(page.slug);
    if (!page.title || !page.description)
      problems.push(`${at} needs a title and a description in its frontmatter`);
    if (!KINDS.has(page.kind))
      problems.push(`${at}: kind is ${page.kind}, not one of ${[...KINDS].join(", ")}`);
    if (page.kind === "internals" && !internal(page.slug))
      problems.push(`${at}: kind internals is for pages under ${where(INTERNALS)}`);
    if (internal(page.slug) && page.kind !== "internals")
      problems.push(`${at}: a page under ${where(INTERNALS)} is kind internals`);
    if (page.views && page.sidebar_class_name !== "experimental")
      problems.push(`${at}: views are experimental: set sidebar_class_name: experimental`);
    if (page.pagination_next === undefined) continue;
    const target = pages.find((p) => docId(p.slug) === page.pagination_next);
    const from = locate(page.slug, sections)?.section;
    const to = target && locate(target.slug, sections)?.section;
    if (!target)
      problems.push(`${at}: pagination_next is ${page.pagination_next}, which is not a page`);
    else if (from && to && from !== to)
      problems.push(
        `${at}: pagination_next is ${page.pagination_next}, in ${to.label}: Next stays in ${from.label}`,
      );
  }
  return problems;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Each post has a title and a description, and its date is a real day. */
export function checkPosts(
  posts: Pick<PostEntry, "slug" | "title" | "date" | "description">[],
): string[] {
  const problems: string[] = [];
  for (const post of posts) {
    if (!post.title || !post.description)
      problems.push(`/blog/${post.slug}/ needs a title and a description in its frontmatter`);
    // Date.parse rolls 2026-02-30 over to March: a real day reads back the same.
    const date = String(post.date);
    const day = Date.parse(`${date}T00:00:00Z`);
    const real = !Number.isNaN(day) && new Date(day).toISOString().slice(0, 10) === date;
    if (!DAY.test(date) || !real)
      problems.push(`/blog/${post.slug}/: ${date} is not a day (YYYY-MM-DD)`);
  }
  return problems;
}
