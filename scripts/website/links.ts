import type { Block } from "../../apps/website/src/docs/types.ts";
import { headingId } from "../../apps/website/src/docs/types.ts";
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

/** Pages that aren't checked pages themselves, but links may name: the list of posts. */
const indexes = ["/blog/"];

/** Every link into the docs or the blog names a page that exists (not a redirect), and its #anchor a heading on that page. */
export function checkLinks(pages: CheckedPage[]): string[] {
  const anchors = new Map([
    ...indexes.map((href) => [href, new Set<string>()] as const),
    ...pages.map((p) => [p.href, new Set(anchorsOf(p.blocks))] as const),
  ]);
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
