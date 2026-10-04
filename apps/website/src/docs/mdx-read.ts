/**
 * A docs page's or blog post's MDX → its frontmatter and the docs blocks
 * (types.ts), so scripts/website.ts checks samples, links, length and prose
 * on what the page shows. markdown.ts has the conventions; an MDX construct
 * outside them is an error, so a page can't slip past the checks.
 */
import fs from "node:fs";
import path from "node:path";
import type { Code, List, PhrasingContent, RootContent, Table } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import type { Block, DiagramName } from "./types.ts";
import { parseMeta, snippetsDir } from "./markdown.ts";
import { websiteDir } from "./site-dir.ts";

/** The file an `include` names, without its final newline. */
export function readSnippet(name: string): string {
  return fs.readFileSync(path.join(websiteDir(), snippetsDir, name), "utf8").replace(/\n$/, "");
}

const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkDirective);

type Node = RootContent & { children?: RootContent[]; name?: string; attributes?: Attr[] };
type Attr = { type: string; name: string; value?: string | { value: string } | null };

/** The docs inline markup back from Markdown: `code`, **strong**, [text](href). */
function inlineOf(nodes: PhrasingContent[]): string {
  return nodes
    .map((n): string => {
      switch (n.type) {
        case "text":
          return n.value;
        case "inlineCode":
          return `\`${n.value}\``;
        case "strong":
          return `**${inlineOf(n.children)}**`;
        case "link": {
          const text = inlineOf(n.children);
          // A bare address (a GFM autolink) is the text it was.
          return text === n.url || `http://${text}` === n.url ? text : `[${text}](${n.url})`;
        }
        case "break":
          return "\n";
        // `a:b` in prose parses as a directive; Starlight renders it back as the text it was.
        case "textDirective":
          return `:${n.name}${n.children.length ? `[${inlineOf(n.children)}]` : ""}`;
        default:
          throw new Error(`line ${n.position?.start.line}: ${n.type} is not docs markup`);
      }
    })
    .join("");
}

function attrOf(node: Node, name: string): string | undefined {
  const a = node.attributes?.find((x) => x.type === "mdxJsxAttribute" && x.name === name);
  if (!a) return undefined;
  if (typeof a.value === "string") return a.value;
  // label={"…"}: a string literal, the way the writer spells a value with quotes.
  if (a.value && typeof a.value === "object") return JSON.parse(a.value.value) as string;
  return "";
}

const where = (n: { position?: { start: { line: number } } }) => `line ${n.position?.start.line}`;

function codeOf(n: Code): Extract<Block, { kind: "code" }> {
  const meta = parseMeta(n.meta);
  const filename = meta.title;
  if (typeof filename !== "string")
    throw new Error(`${where(n)}: a code block needs title="<file name>"`);
  const code = typeof meta.include === "string" ? readSnippet(meta.include) : n.value;
  return {
    kind: "code",
    filename,
    code,
    ...(typeof meta.expect === "string" ? { expect: meta.expect } : {}),
    ...(meta.nocopy ? { copy: false as const } : {}),
    ...(meta.cpp ? { cpp: true as const } : {}),
    ...(n.lang === "diff" ? { diff: true as const } : {}),
    ...(typeof meta.from === "string" ? { from: meta.from } : {}),
  };
}

/** The one paragraph a note, a caption or a list item holds. */
function paragraphText(children: RootContent[] | undefined, what: string): string {
  const [p, ...rest] = children ?? [];
  if (!p || p.type !== "paragraph" || rest.length)
    throw new Error(`${what} holds one paragraph of text`);
  return inlineOf(p.children);
}

function listOf(n: List): Block {
  return {
    kind: "list",
    items: n.children.map((item) => paragraphText(item.children, `${where(item)}: a list item`)),
    ...(n.ordered ? { ordered: true } : {}),
  };
}

function tableOf(n: Table): Block {
  const [head, ...rows] = n.children.map((row) =>
    row.children.map((cell) => inlineOf(cell.children)),
  );
  return { kind: "table", head: head!, rows };
}

function tabItems(n: Node): Node[] {
  const items = (n.children ?? []) as Node[];
  for (const item of items)
    if (item.type !== ("mdxJsxFlowElement" as string) || item.name !== "TabItem")
      throw new Error(`${where(n)}: <Tabs> holds <TabItem>s`);
  return items;
}

export function blocksOf(nodes: RootContent[]): Block[] {
  return nodes.flatMap((node): Block[] => {
    const n = node as Node;
    switch (node.type) {
      case "paragraph":
        return [{ kind: "p", text: inlineOf(node.children) }];
      case "heading":
        if (node.depth !== 2 && node.depth !== 3)
          throw new Error(`${where(node)}: pages use ## and ### headings`);
        return [{ kind: node.depth === 2 ? "h2" : "h3", text: inlineOf(node.children) }];
      case "code":
        return [codeOf(node)];
      case "list":
        return [listOf(node)];
      case "table":
        return [tableOf(node)];
      // Imports and {/* comments */}.
      case "mdxjsEsm":
      case "mdxFlowExpression":
        return [];
      case "containerDirective": {
        const name = (node as { name: string }).name;
        if (name !== "note" && name !== "caution")
          throw new Error(`${where(node)}: :::${name} is not a docs note (:::note, :::caution)`);
        const text = paragraphText(node.children as RootContent[], `${where(node)}: a note`);
        return [{ kind: "note", text, ...(name === "caution" ? { tone: "warn" as const } : {}) }];
      }
      case "mdxJsxFlowElement":
        return [elementOf(n)];
      default:
        throw new Error(`${where(node)}: ${node.type} is not a docs block`);
    }
  });
}

function elementOf(n: Node): Block {
  switch (n.name) {
    case "Tabs": {
      const items = tabItems(n);
      if (attrOf(n, "syncKey") !== undefined)
        return {
          kind: "panels",
          panels: items.map((item) => ({
            label: attrOf(item, "label")!,
            blocks: blocksOf(item.children ?? []),
          })),
        };
      return {
        kind: "tabs",
        tabs: items.map((item) => {
          const [code, ...rest] = item.children ?? [];
          if (code?.type !== "code" || rest.length)
            throw new Error(`${where(item)}: a code <TabItem> holds one code block`);
          const { kind: _, expect: _e, copy: _c, ...tab } = codeOf(code);
          return { label: attrOf(item, "label")!, ...tab };
        }),
      };
    }
    case "Steps": {
      const [list, ...rest] = n.children ?? [];
      if (list?.type !== "list" || !list.ordered || rest.length)
        throw new Error(`${where(n)}: <Steps> holds one numbered list`);
      return {
        kind: "steps",
        steps: list.children.map((item) => {
          const [title, ...blocks] = item.children;
          if (title?.type !== "heading" || title.depth !== 3)
            throw new Error(`${where(item)}: a step starts with its ### title`);
          return { title: inlineOf(title.children), blocks: blocksOf(blocks) };
        }),
      };
    }
    case "CardGrid":
      return {
        kind: "cards",
        items: ((n.children ?? []) as Node[]).map((card) => {
          if (card.name !== "LinkCard")
            throw new Error(`${where(card)}: <CardGrid> holds <LinkCard>s`);
          return {
            title: attrOf(card, "title")!,
            text: attrOf(card, "description")!,
            href: attrOf(card, "href")!,
          };
        }),
      };
    case "Diagram": {
      const caption = n.children?.length
        ? paragraphText(n.children, `${where(n)}: a caption`)
        : undefined;
      return {
        kind: "diagram",
        diagram: attrOf(n, "name") as DiagramName,
        ...(caption ? { caption } : {}),
      };
    }
    case "Comparison":
      return { kind: "comparison" };
    default:
      throw new Error(`${where(n)}: <${n.name}> is not a docs block`);
  }
}

/** A page's frontmatter and blocks. */
export function readMdx(source: string): { frontmatter: Record<string, unknown>; blocks: Block[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!m) throw new Error("the page has no frontmatter");
  const tree = processor.parse(source.slice(m[0].length));
  return {
    frontmatter: (parseYaml(m[1]!) ?? {}) as Record<string, unknown>,
    blocks: blocksOf(tree.children),
  };
}
