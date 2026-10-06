/**
 * The site's remark plugins (astro.config.ts), for the conventions in
 * markdown.ts:
 *   - `include="…"` fills an empty fence with a file from src/generated/snippets/,
 *     and a diff shows as added and removed lines;
 *   - `{{lucent-version}}` in a sample becomes the version of @lucent-lang/lucent;
 *   - TypeScript and JavaScript samples are formatted with Oxfmt;
 *   - a sample flagged `cpp` gets "See the C++" under it (under its tabs, in a
 *     <Tabs>): what the compiler writes for it, from src/generated/cpp/<slug>.json.
 */
import fs from "node:fs";
import path from "node:path";
import type { Code, Root, RootContent } from "mdast";
import { format } from "oxfmt";
import type { CppFile } from "./types.ts";
import { docsSlugOf, formatMeta, langOf, parseMeta } from "./markdown.ts";
import { readSnippet } from "./mdx-read.ts";
import { websiteDir } from "./site-dir.ts";

type Parent = { children: RootContent[] };
type File = { path?: string; history?: string[] };

function eachCode(node: { children?: unknown[] } | RootContent, visit: (code: Code) => void): void {
  if ((node as RootContent).type === "code") return visit(node as Code);
  for (const child of ((node as { children?: unknown[] }).children ?? []) as RootContent[])
    eachCode(child, visit);
}

/**
 * A unified diff as Expressive Code marks one: added and removed lines, with
 * no `@@` hunk headers (a block that starts with one shows as plain text).
 * The first header goes; later ones become a "…" line, where code is skipped.
 */
export function diffForDisplay(diff: string): string {
  let hunks = 0;
  return diff
    .split("\n")
    .flatMap((line) => (line.startsWith("@@") ? (hunks++ === 0 ? [] : [" …"]) : [line]))
    .join("\n");
}

export function remarkInclude() {
  return (tree: Root) => {
    eachCode(tree, (code) => {
      const { include } = parseMeta(code.meta);
      if (typeof include === "string") code.value = readSnippet(include);
      if (code.lang === "diff") code.value = diffForDisplay(code.value);
    });
  };
}

/**
 * The current version where a sample says `{{lucent-version}}`, such as a
 * terminal's `◆ lucent 0.1.2`. Read at build, so a release's version bump
 * needs no regenerated page.
 */
export function remarkVersion() {
  const packageJson = path.join(websiteDir(), "../../packages/lucent/package.json");
  const { version } = JSON.parse(fs.readFileSync(packageJson, "utf8")) as { version: string };
  return (tree: Root) => {
    eachCode(tree, (code) => {
      code.value = code.value.replaceAll("{{lucent-version}}", version);
    });
  };
}

/** The languages Oxfmt formats, as the file extension it reads them by. */
const formatted: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx" };

/**
 * A TypeScript or JavaScript sample as the repository formats its own code
 * (Oxfmt's defaults, as `vp fmt`), whether written on the page or included.
 * A sample Oxfmt can't parse (a fragment, an elided body) shows as written.
 */
export function remarkFormat() {
  return async (tree: Root) => {
    const codes: Code[] = [];
    eachCode(tree, (code) => {
      if (code.lang && code.lang in formatted) codes.push(code);
    });
    await Promise.all(
      codes.map(async (code) => {
        const { code: out, errors } = await format(`sample.${formatted[code.lang!]}`, code.value);
        if (!errors.length) code.value = out.trimEnd();
      }),
    );
  };
}

/** A page's samples' C++, by sample file name: none for a page without `cpp` samples. */
function cppOf(slug: string): Record<string, CppFile[]> {
  const file = path.join(websiteDir(), "src/generated/cpp", `${slug || "index"}.json`);
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CppFile[]>)
    : {};
}

/** A disclosure with platform tabs when the compiler writes more than one file. */
function seeCpp(files: CppFile[]): RootContent {
  const element = (name: string, children: unknown[], props: Record<string, string> = {}) =>
    ({
      type: "mdxJsxFlowElement",
      name,
      attributes: Object.entries(props).map(([name, value]) => ({
        type: "mdxJsxAttribute",
        name,
        value,
      })),
      children,
    }) as unknown as RootContent;
  const codes = files.map((f): Code => ({
    type: "code",
    lang: langOf(f.filename),
    meta: formatMeta({ title: f.filename }),
    value: f.code,
  }));
  return element(
    "details",
    [
      element("summary", [{ type: "text", value: "See the C++" }]),
      ...(files.length > 1
        ? [
            element(
              "Tabs",
              files.map((f, i) => element("TabItem", [codes[i]!], { label: f.label })),
            ),
          ]
        : codes),
    ],
    { className: "see-cpp" },
  );
}

export function remarkSeeCpp() {
  return (tree: Root, file: File) => {
    const slug = docsSlugOf(file.path ?? file.history?.[0] ?? "");
    if (slug === undefined) return;
    const cpp = cppOf(slug);
    const walk = (parent: Parent) => {
      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i]!;
        const shown: CppFile[][] = [];
        eachCode(node, (code) => {
          const meta = parseMeta(code.meta);
          if (!meta.cpp || typeof meta.title !== "string") return;
          const files = cpp[meta.title];
          // Missing when the platform SDK wasn't here to build it: scripts/website.ts says so.
          if (files?.length) shown.push(files);
        });
        if (shown.length && node.type !== "code" && !isTabs(node)) {
          // Inside a list or a panel: put it under the sample itself.
          walk(node as unknown as Parent);
          continue;
        }
        if (shown.length) {
          parent.children.splice(i + 1, 0, ...shown.map(seeCpp));
          i += shown.length;
        }
      }
    };
    walk(tree);
  };
}

const isTabs = (node: RootContent): boolean =>
  node.type === ("mdxJsxFlowElement" as string) &&
  (node as unknown as { name: string; attributes: { name: string }[] }).name === "Tabs" &&
  !(node as unknown as { attributes: { name: string }[] }).attributes.some(
    (a) => a.name === "syncKey",
  );
