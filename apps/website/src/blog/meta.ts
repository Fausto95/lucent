import type { PostEntry } from "./types";

/** Where the site is served: link previews need absolute addresses. */
export const SITE = "https://www.lucent-lang.dev";

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Sets the content of the meta tag `key` names, adding the tag if the page lacks it. */
function setMeta(html: string, attribute: "name" | "property", key: string, value: string): string {
  const tag = `<meta ${attribute}="${key}" content="${escape(value)}" />`;
  const existing = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`);

  return existing.test(html)
    ? html.replace(existing, tag)
    : html.replace("</head>", `${tag}\n</head>`);
}

/**
 * The site's page with a post's own title, summary, image and address:
 * crawlers read these tags without running the page's JavaScript, so the
 * build writes this page at the post's address (vite.config.js).
 */
export function withPostMeta(html: string, post: PostEntry): string {
  const url = `${SITE}/blog/${post.slug}/`;
  const title = `${post.title} — Lucent blog`;
  const properties: [string, string][] = [
    ["og:type", "article"],
    ["og:url", url],
    ["og:title", post.title],
    ["og:description", post.summary],
    ["article:published_time", post.date],
  ];
  const names: [string, string][] = [
    ["description", post.summary],
    ["twitter:title", post.title],
    ["twitter:description", post.summary],
  ];

  if (post.image) {
    properties.push(["og:image", `${SITE}${post.image}`]);
    names.push(["twitter:image", `${SITE}${post.image}`]);
  }
  if (post.imageAlt) properties.push(["og:image:alt", post.imageAlt]);

  let page = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`);

  for (const [key, value] of properties) page = setMeta(page, "property", key, value);
  for (const [key, value] of names) page = setMeta(page, "name", key, value);

  const canonical = `<link rel="canonical" href="${url}" />`;

  return /<link rel="canonical"[^>]*>/.test(page)
    ? page.replace(/<link rel="canonical"[^>]*>/, canonical)
    : page.replace("</head>", `${canonical}\n</head>`);
}
