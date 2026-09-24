/** One searchable section of a docs page (src/generated/search-index.ts). */
export interface SearchEntry {
  href: string;
  page: string;
  heading?: string;
  text: string;
}

export interface SearchResult {
  href: string;
  page: string;
  heading?: string;
  snippet: string;
}

const WEIGHTS = { page: 10, heading: 6, text: 1 } as const;
const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
const hits = (field: string[], term: string): number => field.filter((w) => w.startsWith(term)).length;

/** The text around the first word that starts with one of `terms`. */
function snippetOf(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.search(new RegExp(`(^|[^\\p{L}\\p{N}_])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"))).filter((i) => i >= 0), text.length);
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, start + 140);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Sections that contain every word of `query` as a word prefix, best first. */
export function search(entries: SearchEntry[], query: string, limit = 12): SearchResult[] {
  const terms = words(query);
  if (!terms.length) return [];
  const scored = entries.flatMap((entry) => {
    const fields = { page: words(entry.page), heading: words(entry.heading ?? ""), text: words(entry.text) };
    let score = 0;
    for (const term of terms) {
      const found = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((sum, key) => sum + Math.min(hits(fields[key], term), 3) * WEIGHTS[key], 0);
      if (found === 0) return [];
      score += found;
    }
    return [{ entry, score }];
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => ({ href: entry.href, page: entry.page, ...(entry.heading ? { heading: entry.heading } : {}), snippet: snippetOf(entry.text, terms) }));
}
