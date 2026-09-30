import fs from "node:fs";
import path from "node:path";
import { runnerImport } from "vite";
import { posts as postEntries } from "../../apps/website/src/blog/posts.ts";
import { type Post, type PostEntry, postFile } from "../../apps/website/src/blog/types.ts";
import {
  type Block,
  type DocKind,
  docFile,
  type DocPage,
  docsHref,
} from "../../apps/website/src/docs/types.ts";
import { docsEntries, findDoc } from "../../apps/website/src/docs/nav.ts";
import { docsRedirects } from "../../apps/website/src/docs/redirects.ts";
import type { docModules, postModules } from "./doc-modules.ts";
import { blogDir, docsDir, websiteSrc, where } from "./context.ts";

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

type Modules = { docModules: typeof docModules; postModules: typeof postModules };

/** Every docs page in reading order and every post, with their blocks loaded from their files. */
export async function loadPages(): Promise<{ pages: DocPage[]; posts: Post[] }> {
  const { module } = await runnerImport<Modules>(path.join(import.meta.dirname, "doc-modules.ts"), {
    configFile: false,
    root: websiteSrc,
    logLevel: "error",
  });

  const pages = docsEntries.map((entry) => {
    const page = module.docModules[docFile(entry.slug)];
    if (!page) throw new Error(`${where(entry.slug)} has no ${docFile(entry.slug)}`);
    return { ...entry, blocks: page.blocks };
  });

  const posts = postEntries.map((entry) => {
    const post = module.postModules[postFile(entry.slug)];
    if (!post) throw new Error(`/blog/${entry.slug}/ has no src/blog/${postFile(entry.slug)}`);
    return { ...entry, blocks: post.blocks };
  });

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

/** The `.ts` files under `dir`, relative to it, with forward slashes; none when it doesn't exist. */
function tsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith(".ts"));
}

/** Page files match the nav, every page has its one "Next" link, and retired slugs redirect to pages that exist. */
export function checkStructure(pages: DocPage[]): string[] {
  const problems: string[] = [];
  const slugs = new Set(pages.map((p) => p.slug));
  const files = new Set(pages.map((p) => docFile(p.slug)));
  for (const file of tsFiles(path.join(docsDir, "pages"))) {
    if (!files.has(`pages/${file}`))
      problems.push(`src/docs/pages/${file} is not in the nav (src/docs/nav.ts)`);
  }
  for (const page of pages) {
    if (page.next !== undefined && !slugs.has(page.next))
      problems.push(`${where(page.slug)}: next is ${where(page.next)}, which is not a page`);
    if (!findDoc(page.slug)?.next)
      problems.push(`${where(page.slug)} has no "Next" link: set next in the nav`);
  }
  for (const [from, to] of Object.entries(docsRedirects)) {
    if (slugs.has(from)) problems.push(`redirect from ${where(from)} shadows a page`);
    if (!slugs.has(to)) problems.push(`redirect ${where(from)} → ${where(to)}: no such page`);
  }
  return problems;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Post files (`files`, under src/blog/pages/) match the list, slugs are
 * unique, and each date is a real day, newest first.
 */
export function checkPosts(
  posts: PostEntry[],
  files: string[] = tsFiles(path.join(blogDir, "pages")),
): string[] {
  const problems: string[] = [];

  const listed = new Set(posts.map((p) => postFile(p.slug)));
  for (const file of files) {
    if (!listed.has(`pages/${file}`))
      problems.push(`src/blog/pages/${file} is not a post (src/blog/posts.ts)`);
  }

  const slugs = posts.map((p) => p.slug);
  for (const dup of new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i)))
    problems.push(`two posts are /blog/${dup}/`);

  for (const [i, post] of posts.entries()) {
    // Date.parse rolls 2026-02-30 over to March: a real day reads back the same.
    const day = Date.parse(`${post.date}T00:00:00Z`);
    const real = !Number.isNaN(day) && new Date(day).toISOString().slice(0, 10) === post.date;
    if (!DAY.test(post.date) || !real)
      problems.push(`/blog/${post.slug}/: ${post.date} is not a day (YYYY-MM-DD)`);

    const newer = posts[i - 1];
    if (newer && newer.date < post.date)
      problems.push(`/blog/${post.slug}/ is listed after an older post: list posts newest first`);
  }

  return problems;
}
