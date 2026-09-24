import type { Block, DocPage } from "../../apps/website/src/docs/types.ts";
import { headingId } from "../../apps/website/src/docs/types.ts";
import { where } from "./context.ts";
import { proseOf } from "./prose.ts";

const LINK = /\[[^\]]+\]\((\/[^)]*)\)/g;

function anchorsOf(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.kind === "h2" || b.kind === "h3" ? [headingId(b.text)] : []));
}

/** Every internal link names a page that exists (not a redirect), and its #anchor a heading on that page. */
export function checkLinks(pages: DocPage[]): string[] {
  const anchors = new Map(pages.map((p) => [where(p.slug), new Set(anchorsOf(p.blocks))]));
  const problems: string[] = [];
  for (const page of pages) {
    const hrefs = [
      ...proseOf(page.blocks).flatMap((text) => [...text.matchAll(LINK)].map((m) => m[1]!)),
      ...page.blocks.flatMap((b) => (b.kind === "cards" ? b.items.map((i) => i.href) : [])),
    ];
    for (const href of hrefs) {
      const [pathname = "", anchor] = href.split("#");
      if (!pathname.startsWith("/docs")) continue;
      const target = anchors.get(pathname);
      if (!target) problems.push(`${where(page.slug)}: link to ${href}, which is not a page`);
      else if (anchor && !target.has(anchor)) problems.push(`${where(page.slug)}: link to ${href}, which has no heading #${anchor}`);
    }
  }
  return problems;
}
