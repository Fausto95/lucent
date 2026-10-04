import type { Block } from "../../apps/website/src/docs/types.ts";
import { headingId } from "../../apps/website/src/docs/markdown.ts";
import type { CheckedPage } from "./pages.ts";
import { proseOf } from "./prose.ts";

const LINK = /\[[^\]]+\]\((\/[^)]*)\)/g;

function anchorsOf(blocks: Block[]): string[] {
  return blocks.flatMap((b) => {
    if (b.kind === "h2" || b.kind === "h3") return [headingId(b.text)];
    if (b.kind === "steps")
      return b.steps.flatMap((s) => [headingId(s.title), ...anchorsOf(s.blocks)]);
    if (b.kind === "panels") return b.panels.flatMap((p) => anchorsOf(p.blocks));
    return [];
  });
}

/** Pages that aren't checked pages themselves, but links may name: the list of posts, and its feed. */
const indexes = ["/blog/", "/blog/rss.xml"];

/** Each page's URL and the anchors of its headings. */
function anchorMap(pages: CheckedPage[]): Map<string, Set<string>> {
  return new Map([
    ...indexes.map((href) => [href, new Set<string>()] as const),
    ...pages.map((p) => [p.href, new Set(anchorsOf(p.blocks))] as const),
  ]);
}

/** Every link into the docs or the blog names a page that exists, and its #anchor a heading on that page. */
export function checkLinks(pages: CheckedPage[]): string[] {
  const anchors = anchorMap(pages);
  const problems: string[] = [];
  for (const page of pages) {
    const hrefs = [
      ...proseOf(page.blocks).flatMap((text) => [...text.matchAll(LINK)].map((m) => m[1]!)),
      ...page.blocks.flatMap((b) => (b.kind === "cards" ? b.items.map((i) => i.href) : [])),
    ];
    for (const href of hrefs) {
      const [pathname = "", anchor] = href.split("#");
      if (!pathname.startsWith("/docs") && !pathname.startsWith("/blog")) continue;
      const target = anchors.get(pathname);
      if (!target) problems.push(`${page.href}: link to ${href}, which is not a page`);
      else if (anchor && !target.has(anchor))
        problems.push(`${page.href}: link to ${href}, which has no heading #${anchor}`);
    }
  }
  return problems;
}

/** The site's URLs, as the READMEs and the CLI write them, and root-relative links in Markdown and HTML. */
const SITE_URL = /https:\/\/(?:www\.)?lucent-lang\.dev(\/(?:docs|blog)\/[^\s)"'<>\]`]*)/g;
const ROOT_LINK = /(?:href=["']|\]\()(\/(?:docs|blog)\/[^"')\s]*)/g;

/**
 * Links into the docs or the blog from files that aren't pages (the
 * homepage, the READMEs, docs/): each names a page that exists and, after
 * a #, one of its headings. A problem names the file and line.
 */
export function checkOutsideLinks(
  files: { name: string; text: string }[],
  pages: CheckedPage[],
): string[] {
  const anchors = anchorMap(pages);
  const problems: string[] = [];
  for (const { name, text } of files)
    for (const match of [...text.matchAll(SITE_URL), ...text.matchAll(ROOT_LINK)]) {
      const href = match[1]!.replace(/[.,;:]+$/, "");
      const [pathname = "", anchor] = href.split("#");
      const line = text.slice(0, match.index).split("\n").length;
      const target = anchors.get(pathname);
      if (!target) problems.push(`${name}:${line}: link to ${href}, which is not a page`);
      else if (anchor && !target.has(anchor))
        problems.push(`${name}:${line}: link to ${href}, which has no heading`);
    }
  return problems;
}
