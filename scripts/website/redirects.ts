import {
  docsRedirects,
  publishedUrls,
  rootRedirects,
  vercelRedirects,
} from "../../apps/website/src/docs/redirects.ts";
import { docsHref } from "../../apps/website/src/docs/types.ts";

/**
 * Every old URL redirects to a page that exists, no old URL is a page
 * itself (the redirect would hide it), and every URL a published CLI or
 * README names is a page or redirects to one.
 */
export function checkRedirects(slugs: string[]): string[] {
  const pages = new Set(slugs.map(docsHref));
  const problems: string[] = [];
  for (const [from, to] of Object.entries(docsRedirects)) {
    if (!pages.has(docsHref(to)))
      problems.push(`redirect /docs/${from}/ → ${docsHref(to)}, which is not a page`);
    if (pages.has(docsHref(from)))
      problems.push(`redirect /docs/${from}/ is a page: remove it from src/docs/redirects.ts`);
  }
  for (const [from, to] of Object.entries(rootRedirects))
    if (!pages.has(to)) problems.push(`redirect ${from} → ${to}, which is not a page`);
  const redirected = new Set(Object.keys(docsRedirects).map(docsHref));
  for (const url of publishedUrls)
    if (!pages.has(url) && !redirected.has(url))
      problems.push(`${url}, which published CLIs link to, is neither a page nor redirected`);
  return problems;
}

/** vercel.json with its redirects from src/docs/redirects.ts, keeping its other fields. */
export function vercelJson(current: string): string {
  const config = JSON.parse(current) as Record<string, unknown>;
  return `${JSON.stringify({ ...config, redirects: vercelRedirects() }, null, 2)}\n`;
}
