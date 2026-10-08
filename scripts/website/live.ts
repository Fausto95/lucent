/**
 * Checks the deployed site, not the build: every URL the site promises
 * (its pages, the old URLs vercel.json redirects, the URLs published CLIs
 * and READMEs print) answers, after its redirects, with a page, and a
 * #fragment names an id on that page. `node scripts/website.ts --check-live`
 * runs it against https://lucent-lang.dev (or LUCENT_SITE_URL), after a
 * deploy: the build's checks can't see a redirect Vercel didn't apply or
 * a page it didn't publish.
 */

/** What the check needs of an HTTP response: tests pass fakes. */
export interface LiveResponse {
  status: number;
  location?: string;
  body: string;
}
export type LiveFetch = (url: string) => Promise<LiveResponse>;

/** fetch(), without following redirects, so each hop is checked. */
export const httpFetch: LiveFetch = async (url) => {
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("location") ?? undefined;
  return { status: res.status, ...(location ? { location } : {}), body: await res.text() };
};

const MAX_HOPS = 5;

/** Ids a page's HTML gives its elements: what a #fragment can land on. */
function hasId(html: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\sid=["']?${escaped}["'\\s>]`).test(html);
}

/** One URL: its redirects lead, within MAX_HOPS, to a 200 that has the fragment's id. */
async function checkOne(base: string, href: string, get: LiveFetch): Promise<string | undefined> {
  const [pathname = "", fragment] = href.split("#");
  let url = new URL(pathname, base).toString();
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: LiveResponse;
    try {
      res = await get(url);
    } catch (e) {
      return `${href}: ${url} failed: ${(e as Error).message}`;
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, url);
      if (next.origin !== new URL(base).origin)
        return `${href}: redirects off the site, to ${next.toString()}`;
      url = next.toString();
      continue;
    }
    if (res.status !== 200) return `${href}: ${url} answered ${res.status}`;
    if (fragment && !hasId(res.body, fragment))
      return `${href}: ${url} has no element with id ${fragment}`;
    return undefined;
  }
  return `${href}: more than ${MAX_HOPS} redirects`;
}

/**
 * Each href (a path under the site, with an optional #fragment) against
 * the site at `base`, a few at a time. Returns the problems, in hrefs' order.
 */
export async function checkLive(
  base: string,
  hrefs: string[],
  get: LiveFetch = httpFetch,
  concurrency = 8,
): Promise<string[]> {
  const unique = [...new Set(hrefs)];
  // Fragments of one page (each diagnostic's #code) fetch it once.
  const seen = new Map<string, Promise<LiveResponse>>();
  const once: LiveFetch = (url) => {
    if (!seen.has(url)) seen.set(url, get(url));
    return seen.get(url)!;
  };
  const results: (string | undefined)[] = Array.from({ length: unique.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < unique.length) {
      const i = next++;
      results[i] = await checkOne(base, unique[i]!, once);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return results.filter((r): r is string => !!r);
}

/** The site's URLs as files outside its pages name them (READMEs, the CLI): path and #fragment. */
export function siteUrlsIn(text: string): string[] {
  return [...text.matchAll(/https:\/\/(?:www\.)?lucent-lang\.dev(\/[^\s)"'<>\]`]*)/g)].map((m) =>
    m[1]!.replace(/[.,;:]+$/, ""),
  );
}
