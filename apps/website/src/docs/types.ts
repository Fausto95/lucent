/**
 * The docs block model: what a page shows, as scripts/website.ts checks it.
 * Pages are MDX (src/content/docs/docs/); mdx-read.ts reads one into blocks,
 * and mdx-write.ts writes the generated reference pages from templates
 * (src/docs/templates/) built of blocks. Paragraph-like strings carry a tiny
 * inline markup: `code`, **strong**, and [text](href). Internal hrefs start with "/".
 *
 * Code whose filename ends in `.lucent.ts` (or `.lucent.tsx`) must compile: the samples of a
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
   * `diff: true` shows a unified diff (what a change did); it isn't compiled.
   * `from` names the repository file the sample is, generated from it: a module that compiles
   * only in its app (it imports the app's own libraries), so the app's build checks it instead.
   */
  | {
      kind: "code";
      filename: string;
      code: string;
      expect?: string;
      copy?: false;
      cpp?: true;
      diff?: true;
      from?: string;
    }
  | {
      kind: "tabs";
      tabs: {
        label: string;
        filename: string;
        code: string;
        cpp?: true;
        diff?: true;
        from?: string;
      }[];
    }
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

/** Diagrams are components, looked up by name in components/Diagram.astro. */
export type DiagramName =
  | "build-check"
  | "build-cpp"
  | "build-package"
  | "build-app"
  | "build-metro"
  | "call-sync"
  | "call-async"
  | "platform-call"
  | "places"
  | "threads";

/**
 * The kinds of docs page, and each one's length budget (CONTRIBUTING-DOCS.md):
 * words of prose and lines of code; undefined is unbounded. Start: what
 * Lucent is and getting it running, read in order. Guide: one task.
 * Explanation: how a part of Lucent works and why. Example: a whole module
 * from the example apps. Reference: the exact rules, generated where
 * possible. Internals: how Lucent's code works, for contributors (only
 * under architecture/internals).
 */
export const DOC_KINDS = {
  start: { words: 400, code: 60 },
  guide: { words: 400, code: 60 },
  explanation: { words: 800, code: 120 },
  // A whole module is the point of an example page.
  example: { words: 400, code: Infinity },
  reference: undefined,
  internals: undefined,
} as const satisfies Record<string, { words: number; code: number } | undefined>;

export type DocKind = keyof typeof DOC_KINDS;

/**
 * A docs page's frontmatter (src/content.config.ts validates it). Starlight
 * reads title, description and next; the checks read the rest.
 */
export interface DocFrontmatter {
  /** The task or the question the page answers. */
  title: string;
  /** One sentence: the answer, or what the reader has at the end. Also the <meta name="description">. */
  description: string;
  kind: DocKind;
  /** The page's one "Next" link, when it isn't the following page in the sidebar. */
  next?: { link: string; label: string };
  /** Starlight's sidebar entry: a shorter label, or a badge ("Experimental" on pages about views). */
  sidebar?: { label?: string; badge?: string };
  /**
   * A directory (from the repository root) whose `*.lucent.ts` files compile with
   * the page's samples, so a page can show one module of a project, or its diff.
   */
  samplesWith?: string;
  /**
   * The page's samples include components drawn with SwiftUI and Compose
   * (`.lucent.tsx`): they compile with the components' views generated.
   */
  views?: true;
}

/** A docs page: its path under /docs/ ("" is the index), frontmatter and blocks. */
export interface DocPage extends DocFrontmatter {
  slug: string;
  blocks: Block[];
}

/** What a template (src/docs/templates/<slug>.ts) exports: a generated page. */
export interface DocTemplate {
  frontmatter: DocFrontmatter;
  blocks: Block[];
}

/** One file the compiler writes for a sample, as "See the C++" shows it. */
export interface CppFile {
  /** "C++", or the platform for code built per platform. */
  label: string;
  filename: string;
  code: string;
}

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}/` : "/docs/");
