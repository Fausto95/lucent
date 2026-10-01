/**
 * How a docs page's MDX spells the docs block model (types.ts): shared by
 * the site's remark plugins (remark.ts), the reader the checks use
 * (mdx-read.ts) and the writer for generated pages (mdx-write.ts).
 *
 * A code sample is a fence whose meta names its file and its flags:
 *
 *   ```ts title="geo.lucent.ts" cpp           "See the C++" under it
 *   ```ts title="bad.lucent.ts" expect="LUCENT2001"
 *   ```sh title="terminal" nocopy             output, no copy button
 *   ```diff lang="ts" title="src/trip.lucent.ts"
 *   ```ts title="linked.lucent.ts" from="apps/bare-example/src/sdk/linked.lucent.ts"
 *   ```ts title="clipboard.lucent.ts" include="examples/clipboard.lucent.ts"
 *
 * `include` fills an empty fence with a file scripts/website.ts writes under
 * src/generated/snippets/, so a page shows code from the repository without
 * copying it.
 */
import { slug } from "github-slugger";

/** The highlighting language for a sample, from its file name ("terminal" is a shell). */
export function langOf(filename: string): string {
  const name = filename.replace(/ \((right|wrong)\)$/, "");
  if (name === "terminal") return "sh";
  const ext = /\.([a-z]+)$/.exec(name)?.[1] ?? "";
  const langs: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    json: "json",
    kt: "kotlin",
    swift: "swift",
    plist: "xml",
    cpp: "cpp",
    mm: "objective-cpp",
    h: "cpp",
  };
  return langs[ext] ?? "text";
}

/** A fence's meta: `key="value"` pairs and bare flags. */
export function parseMeta(meta: string | null | undefined): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const m of (meta ?? "").matchAll(/([\w-]+)(?:="((?:[^"\\]|\\.)*)")?/g))
    out[m[1]!] = m[2] === undefined ? true : m[2].replace(/\\(.)/g, "$1");
  return out;
}

export function formatMeta(meta: Record<string, string | true | undefined>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === true ? k : `${k}="${v!.replace(/["\\]/g, "\\$&")}"`))
    .join(" ");
}

/** Inline markup out: what a heading's text reads as. */
export const plainText = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

/** Heading text → URL fragment, as Astro writes heading ids (github-slugger). */
export const headingId = (text: string): string => slug(plainText(text));

/** Where `include` finds its files, from the website's root. */
export const snippetsDir = "src/generated/snippets";

/** A page's slug from its file under src/content/docs/docs/ ("" for the index), or undefined. */
export function docsSlugOf(file: string): string | undefined {
  const m = /src\/content\/docs\/docs\/(.+)\.mdx$/.exec(file.split("\\").join("/"));
  if (!m) return undefined;
  return m[1] === "index" ? "" : m[1]!.replace(/\/index$/, "");
}
