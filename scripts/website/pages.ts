import fs from "node:fs";
import path from "node:path";
import { runnerImport } from "vite";
import { readMdx } from "../../apps/website/src/docs/mdx-read.ts";
import type { PostEntry } from "../../apps/website/src/blog/types.ts";
import { docsGroups, docsSlugs } from "../../apps/website/src/docs/nav.ts";
import { docsRedirects } from "../../apps/website/src/docs/redirects.ts";
import {
  type Block,
  type DocFrontmatter,
  type DocKind,
  type DocPage,
  type DocTemplate,
  docsHref,
} from "../../apps/website/src/docs/types.ts";
import type { docTemplates } from "./doc-modules.ts";
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
  /** A docs page's description, a post's summary. */
  description: string;
  blocks: Block[];
  samplesWith?: string;
  /** Its samples include components drawn with SwiftUI and Compose: they compile with views. */
  views?: true;
}

export interface Post extends PostEntry {
  blocks: Block[];
}

/** The reference pages' templates (src/docs/templates/), by slug. */
export async function loadTemplates(): Promise<Record<string, DocTemplate>> {
  const { module } = await runnerImport<{ docTemplates: typeof docTemplates }>(
    path.join(import.meta.dirname, "doc-modules.ts"),
    { configFile: false, root: websiteSrc, logLevel: "error" },
  );
  return module.docTemplates;
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
      description: p.summary,
      blocks: p.blocks,
      ...(p.views ? { views: p.views } : {}),
    })),
  ];
}

const KINDS = new Set<DocKind>(["start", "learn", "guide", "reference", "example", "other"]);

/**
 * Page files match the sidebar (src/docs/nav.ts), each page says its kind
 * and has its one "Next" link, and retired slugs redirect to pages that exist.
 */
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

  const hrefs = new Set(pages.map((p) => docsHref(p.slug)));
  const last = docsGroups.at(-1)?.slugs.at(-1);
  for (const page of pages) {
    if (!page.title || !page.description)
      problems.push(`${where(page.slug)} needs a title and a description in its frontmatter`);
    if (!KINDS.has(page.kind))
      problems.push(
        `${where(page.slug)}: kind is ${page.kind}, not one of ${[...KINDS].join(", ")}`,
      );
    if (page.next !== undefined) {
      if (!hrefs.has(page.next.link))
        problems.push(`${where(page.slug)}: next is ${page.next.link}, which is not a page`);
      else if (page.next.label !== pages.find((p) => docsHref(p.slug) === page.next!.link)?.title)
        problems.push(`${where(page.slug)}: next's label should be its page's title`);
    } else if (page.slug === last)
      problems.push(`${where(page.slug)} has no "Next" link: set next in its frontmatter`);
  }
  for (const [from, to] of Object.entries(docsRedirects)) {
    if (slugs.has(from)) problems.push(`redirect from ${where(from)} shadows a page`);
    if (!slugs.has(to)) problems.push(`redirect ${where(from)} → ${where(to)}: no such page`);
  }
  return problems;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Each post has a title and summary, and its date is a real day. */
export function checkPosts(
  posts: Pick<PostEntry, "slug" | "title" | "date" | "summary">[],
): string[] {
  const problems: string[] = [];
  for (const post of posts) {
    if (!post.title || !post.summary)
      problems.push(`/blog/${post.slug}/ needs a title and a summary in its frontmatter`);
    // Date.parse rolls 2026-02-30 over to March: a real day reads back the same.
    const date = String(post.date);
    const day = Date.parse(`${date}T00:00:00Z`);
    const real = !Number.isNaN(day) && new Date(day).toISOString().slice(0, 10) === date;
    if (!DAY.test(date) || !real)
      problems.push(`/blog/${post.slug}/: ${date} is not a day (YYYY-MM-DD)`);
  }
  return problems;
}
