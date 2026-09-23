/**
 * Docs pages are plain data with no React imports, so tools can load them in
 * Node (scripts/website.ts checks every Lucent sample). Paragraph-like
 * strings accept a tiny inline markup: `code`, **strong**, and [text](href).
 * Internal hrefs start with "/".
 *
 * Code whose filename ends in `.lucent.ts` must compile: the samples of a
 * page are checked together, as one app. A sample that demonstrates a
 * diagnostic sets `expect` to its code and is checked on its own.
 */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "code"; filename: string; code: string; expect?: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "note"; text: string; tone?: "info" | "warn" }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "diagram"; diagram: DiagramName; caption?: string }
  | { kind: "steps"; steps: { title: string; blocks: Block[] }[] }
  | { kind: "cards"; items: { title: string; text: string; href: string }[] };

/** Diagrams are components, looked up by name in components/DocsDiagram.tsx. */
export type DiagramName = "pipeline" | "runtime";

export interface DocPage {
  /** Path under /docs/, without slashes. "" is the index. */
  slug: string;
  title: string;
  /** One sentence, used for <meta name="description"> and the page lead. */
  description: string;
  blocks: Block[];
}

export interface DocGroup {
  label: string;
  pages: DocPage[];
}

/** Heading text → URL fragment, shared by the renderer and the table of contents. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}/` : "/docs/");
