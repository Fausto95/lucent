import type { PostEntry } from "./types";

/** Where the site is served: link previews need absolute addresses. */
export const SITE = "https://www.lucent-lang.dev";

/** Text made safe inside an HTML or XML attribute or element. */
export const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export interface HeadEntry {
  tag: "meta" | "link";
  attrs: Record<string, string>;
}

/**
 * A post's own link-preview tags: Starlight writes these into the post's
 * page, replacing the site's tags of the same name (astro.config.ts).
 */
export function postHead(post: PostEntry): HeadEntry[] {
  const url = `${SITE}/blog/${post.slug}/`;
  const meta = (attribute: "name" | "property", key: string, content: string): HeadEntry => ({
    tag: "meta",
    attrs: { [attribute]: key, content },
  });
  return [
    meta("property", "og:type", "article"),
    meta("property", "article:published_time", post.date),
    meta("name", "twitter:title", post.title),
    meta("name", "twitter:description", post.summary),
    ...(post.image
      ? [
          meta("property", "og:image", `${SITE}${post.image}`),
          meta("name", "twitter:image", `${SITE}${post.image}`),
        ]
      : []),
    ...(post.imageAlt ? [meta("property", "og:image:alt", post.imageAlt)] : []),
    { tag: "link", attrs: { rel: "canonical", href: url } },
  ];
}
