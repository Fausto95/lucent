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
  /**
   * `copy: false` for output the reader reads rather than runs (a terminal's output).
   * `cpp: true` on a `.lucent.ts` sample adds "See the C++": what the compiler writes for it.
   */
  | { kind: "code"; filename: string; code: string; expect?: string; copy?: false; cpp?: true }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string; cpp?: true }[] }
  | { kind: "note"; text: string; tone?: "info" | "warn" }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "diagram"; diagram: DiagramName; caption?: string }
  /** The Lucent / Expo Modules / Nitro / Turbo Native Modules table (docs/comparison-table.ts). */
  | { kind: "comparison" }
  | { kind: "steps"; steps: { title: string; blocks: Block[] }[] }
  /** One of several setups (Expo, bare React Native): the reader picks a tab, and the choice carries across pages. */
  | { kind: "panels"; panels: { label: string; blocks: Block[] }[] }
  | { kind: "cards"; items: { title: string; text: string; href: string }[] };

/** Diagrams are components, looked up by name in components/DocsDiagram.tsx. */
export type DiagramName =
  | "build-check"
  | "build-cpp"
  | "build-package"
  | "build-app"
  | "build-metro"
  | "call-sync"
  | "call-async"
  | "platform-call";

/**
 * Start: what Lucent is and getting it running. Learn: how to think in it,
 * read in order. Guide: one task. Reference: the exact rules, generated where
 * possible. Example: a whole module from the example apps. The kind sets the
 * page's length budget (CONTRIBUTING-DOCS.md).
 */
export type DocKind = "start" | "learn" | "guide" | "reference" | "example" | "other";

/**
 * A page's metadata; the nav lists these in reading order. The page's blocks
 * live in `pages/<slug>.ts` (`pages/index.ts` for the empty slug), loaded
 * when the page is visited.
 */
export interface DocEntry {
  /** Path under /docs/, without slashes. "" is the index. */
  slug: string;
  kind: DocKind;
  /** The task or the question the page answers. */
  title: string;
  /** One sentence: the answer, or what the reader has at the end. Also the <meta name="description">. */
  description: string;
  /** The page's one "Next" link, when it isn't the following page in reading order. */
  next?: string;
  /** Written before CONTRIBUTING-DOCS.md; Vale only warns. Goes away as each page is replaced. */
  legacy?: true;
}

export interface DocGroup {
  label: string;
  entries: DocEntry[];
}

/** What a page file exports. */
export interface DocModule {
  blocks: Block[];
}

export interface DocPage extends DocEntry {
  blocks: Block[];
}

/** One file the compiler writes for a sample, as "See the C++" shows it. */
export interface CppFile {
  /** "C++", or the platform for code built per platform. */
  label: string;
  filename: string;
  code: string;
}

/** What src/generated/cpp/<slug>.ts exports: a page's samples' C++, by sample filename. */
export interface CppModule {
  cpp: Record<string, CppFile[]>;
}

/** The file holding a page's blocks, relative to src/docs/. */
export const docFile = (slug: string): string => `pages/${slug || "index"}.ts`;

/** Heading text → URL fragment, shared by the renderer and the table of contents. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}/` : "/docs/");
