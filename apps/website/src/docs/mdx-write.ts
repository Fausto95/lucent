/**
 * Docs blocks → MDX (markdown.ts has the conventions). scripts/website.ts
 * writes the generated reference pages with it, from src/docs/templates/;
 * mdx-read.ts reads any page back into the same blocks.
 */
import { stringify } from "yaml";
import type { Block } from "./types.ts";
import { formatMeta, langOf } from "./markdown.ts";

export interface WriteOptions {
  /** The snippet (under src/generated/snippets/) a sample's code is, to include it rather than copy it. */
  include?: (code: string) => string | undefined;
  /** Rewrites a link's href, e.g. a heading's old anchor. */
  href?: (href: string) => string;
  /** Where the components a page uses are imported from. */
  components?: string;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/** Plain text, escaped so Markdown and MDX read it back as the same characters. */
function escapeText(text: string): string {
  return text.replace(/[\\{}<>*_[\]~`]/g, "\\$&").replace(/&(?=[#\w]+;)/g, "\\&");
}

/** The docs inline markup (`code`, **strong**, [text](href)) as Markdown. */
export function inline(text: string, opts: WriteOptions = {}): string {
  const out = text
    .split(TOKEN)
    .map((token) => {
      if (/^`[^`]+`$/.test(token)) return token;
      if (/^\*\*[^*]+\*\*$/.test(token)) return `**${inline(token.slice(2, -2), opts)}**`;
      const link = LINK.exec(token);
      if (link) return `[${inline(link[1]!, opts)}](${opts.href ? opts.href(link[2]!) : link[2]})`;
      return escapeText(token);
    })
    .join("");
  // What would open a block at the start of a line: a heading, a list, a quote, a table.
  return out.replace(/^(#|[-+>|]|\d+[.)])/, (m) =>
    m.length > 1 ? m.replace(/[.)]$/, "\\$&") : `\\${m}`,
  );
}

const attr = (value: string): string =>
  /["{}]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;

const indent = (text: string, by: string): string =>
  text
    .split("\n")
    .map((line) => (line ? by + line : line))
    .join("\n");

function fence(
  code: {
    filename: string;
    code: string;
    diff?: true;
    cpp?: true;
    expect?: string;
    copy?: false;
    from?: string;
  },
  opts: WriteOptions,
): string {
  const lang = langOf(code.filename);
  const include = opts.include?.(code.code);
  const meta = formatMeta({
    ...(code.diff ? { lang } : {}),
    title: code.filename,
    cpp: code.cpp,
    expect: code.expect,
    nocopy: code.copy === false ? true : undefined,
    from: code.from,
    include,
  });
  const body = include ? "" : `${code.code}\n`;
  const ticks = "`".repeat(
    Math.max(3, ...[...code.code.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)),
  );
  return `${ticks}${code.diff ? "diff" : lang} ${meta}\n${body}${ticks}`;
}

/** The components a page's blocks use, by import source. */
function componentsOf(blocks: Block[]): Set<string> {
  const used = new Set<string>();
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.kind === "tabs" || b.kind === "panels") used.add("Tabs").add("TabItem");
      if (b.kind === "steps") used.add("Steps");
      if (b.kind === "cards") used.add("CardGrid").add("LinkCard");
      if (b.kind === "diagram") used.add("Diagram");
      if (b.kind === "comparison") used.add("Comparison");
      if (b.kind === "steps") b.steps.forEach((s) => walk(s.blocks));
      if (b.kind === "panels") b.panels.forEach((p) => walk(p.blocks));
    }
  };
  walk(blocks);
  return used;
}

export function blocksToMdx(blocks: Block[], opts: WriteOptions = {}): string {
  return blocks.map((b) => blockToMdx(b, opts)).join("\n\n");
}

function blockToMdx(b: Block, opts: WriteOptions): string {
  switch (b.kind) {
    case "p":
      return inline(b.text, opts);
    case "h2":
      return `## ${inline(b.text, opts)}`;
    case "h3":
      return `### ${inline(b.text, opts)}`;
    case "code":
      return fence(b, opts);
    case "tabs":
      return [
        "<Tabs>",
        ...b.tabs.map((t) => `<TabItem label=${attr(t.label)}>\n\n${fence(t, opts)}\n\n</TabItem>`),
        "</Tabs>",
      ].join("\n");
    case "panels":
      return [
        '<Tabs syncKey="setup">',
        ...b.panels.map(
          (p) => `<TabItem label=${attr(p.label)}>\n\n${blocksToMdx(p.blocks, opts)}\n\n</TabItem>`,
        ),
        "</Tabs>",
      ].join("\n");
    case "note":
      return `:::${b.tone === "warn" ? "caution" : "note"}\n${inline(b.text, opts)}\n:::`;
    case "list":
      return b.items
        .map(
          (item, i) =>
            `${b.ordered ? `${i + 1}.` : "-"} ${inline(item, opts).replace(/^\\(?=[-+>#|])/, "")}`,
        )
        .join("\n");
    case "table": {
      const cell = (c: string) =>
        inline(c, opts)
          .replace(/\|/g, "\\|")
          .replace(/^\\(?=[-+>#])/, "");
      return [
        `| ${b.head.map(cell).join(" | ")} |`,
        `| ${b.head.map(() => "---").join(" | ")} |`,
        ...b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
      ].join("\n");
    }
    case "diagram":
      return b.caption
        ? `<Diagram name="${b.diagram}">\n\n${inline(b.caption, opts)}\n\n</Diagram>`
        : `<Diagram name="${b.diagram}" />`;
    case "comparison":
      return "<Comparison />";
    case "steps":
      return [
        "<Steps>",
        "",
        b.steps
          .map(
            (s, i) =>
              `${i + 1}. ### ${inline(s.title, opts)}\n\n${indent(blocksToMdx(s.blocks, opts), "   ")}`,
          )
          .join("\n\n"),
        "",
        "</Steps>",
      ].join("\n");
    case "cards":
      return [
        "<CardGrid>",
        ...b.items.map(
          (c) =>
            `  <LinkCard title=${attr(c.title)} description=${attr(c.text)} href="${opts.href ? opts.href(c.href) : c.href}" />`,
        ),
        "</CardGrid>",
      ].join("\n");
  }
}

/** A whole page: frontmatter, the imports its blocks need, a note when it is generated, then its blocks. */
export function pageToMdx(
  frontmatter: Record<string, unknown>,
  blocks: Block[],
  opts: WriteOptions & { generatedFrom?: string } = {},
): string {
  const used = componentsOf(blocks);
  const starlight = ["Tabs", "TabItem", "Steps", "CardGrid", "LinkCard"].filter((c) => used.has(c));
  const own = ["Diagram", "Comparison"].filter((c) => used.has(c));
  const dir = opts.components ?? "~/components";
  const imports = [
    ...(starlight.length
      ? [`import { ${starlight.join(", ")} } from "@astrojs/starlight/components";`]
      : []),
    ...own.map((c) => `import ${c} from "${dir}/${c}.astro";`),
  ];
  const head = [
    `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---`,
    ...(opts.generatedFrom
      ? [`{/* Generated by scripts/website.ts from ${opts.generatedFrom}. Do not edit. */}`]
      : []),
    ...(imports.length ? [imports.join("\n")] : []),
  ];
  return `${[...head, blocksToMdx(blocks, opts)].join("\n\n")}\n`;
}
