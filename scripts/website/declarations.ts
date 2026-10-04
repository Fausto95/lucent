/**
 * Reads a declaration file (packages/compiler/lib/sdk/*.d.ts, lib/globals.d.ts)
 * into what the API pages show of each export: its signature, its own doc
 * comment as paragraphs and examples, and its members.
 */
import ts from "typescript";
import type { Declaration, Member, ModuleDeclarations } from "../../apps/website/src/docs/api.ts";

/** Members and type parts that only tag a type for the compiler. */
const BRAND = /__lucent|"lucent:compose\.|\[delivery\]/;
const TYPE_BRAND = /\s*&\s*\{\s*readonly\s+(?:"lucent:[^"]+"|\[delivery\])\??:[^}]*\}/g;

/** The text of a `/** … *\/` comment, without its markers and leading `*`s. */
function commentText(raw: string): string {
  return raw
    .replace(/^\/\*\*\s?/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

/** A comment's paragraphs and code blocks; `@tag` lines are left out. */
function parseDoc(text: string): { doc: string[]; examples: string[] } {
  const examples: string[] = [];
  const prose = text
    .replace(/```\w*\n([\s\S]*?)\n```/g, (_, code: string) => {
      examples.push(code.trimEnd());
      return "\n\n";
    })
    .split("\n")
    .filter((line) => !/^@\w+/.test(line.trim()))
    .join("\n");
  const doc = prose
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
  return { doc, examples };
}

/** Signature text: no `export declare`, no doc comments, no brands, no blank lines. */
function signatureOf(text: string): string {
  return text
    .replace(/^export\s+/, "")
    .replace(/^declare\s+/, "")
    .replace(/[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*\n?/g, "")
    .replace(TYPE_BRAND, "")
    .split("\n")
    .filter((line) => !BRAND.test(line) && line.trim() !== "")
    .join("\n");
}

const KINDS: [(n: ts.Node) => boolean, Declaration["kind"]][] = [
  [ts.isFunctionDeclaration, "function"],
  [ts.isClassDeclaration, "class"],
  [ts.isInterfaceDeclaration, "interface"],
  [ts.isTypeAliasDeclaration, "type"],
  [ts.isVariableStatement, "const"],
  [ts.isModuleDeclaration, "namespace"],
  [ts.isEnumDeclaration, "enum"],
];

const exported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

export function declarationsOf(file: string, text: string): ModuleDeclarations {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const opening = /^\/\*\*[\s\S]*?\*\//.exec(text);

  /** The node's own doc comment: the last before it, never the file's opening one. */
  const docOf = (node: ts.Node): string | undefined => {
    const ranges = (ts.getLeadingCommentRanges(text, node.pos) ?? []).filter(
      (r) => text.startsWith("/**", r.pos) && !(opening && r.pos === 0),
    );
    const last = ranges.at(-1);
    return last && commentText(text.slice(last.pos, last.end));
  };

  // A file without imports or exports declares globals: its interfaces are what it adds.
  const isModule = sf.statements.some((s) => exported(s) || ts.isImportDeclaration(s));
  const shown = sf.statements.filter((s) =>
    isModule ? exported(s) : ts.isInterfaceDeclaration(s),
  );

  const declarations = shown.map((node): Declaration => {
    const kind = KINDS.find(([is]) => is(node))?.[1];
    const name = ts.isVariableStatement(node)
      ? node.declarationList.declarations[0]!.name.getText(sf)
      : ((node as ts.DeclarationStatement).name?.getText(sf) ?? "");
    if (!kind)
      throw new Error(`${file}: ${name || "a statement"} is not a declaration the docs know`);
    const comment = docOf(node);
    if (!comment) throw new Error(`${file}: ${name} has no doc comment`);
    const members =
      ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
        ? node.members.flatMap((m): Member[] => {
            const signature = text.slice(m.getStart(sf), m.end).trim();
            const isPrivate = (ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : []).some(
              (x) => x.kind === ts.SyntaxKind.PrivateKeyword,
            );
            if (BRAND.test(signature) || isPrivate) return [];
            const own = docOf(m);
            return [
              {
                name: m.name
                  ? m.name.getText(sf)
                  : ts.isConstructorDeclaration(m)
                    ? "constructor"
                    : "[index]",
                signature,
                doc: own ? parseDoc(own).doc.join(" ") : "",
              },
            ];
          })
        : [];
    return {
      name,
      kind,
      signature: signatureOf(text.slice(node.getStart(sf), node.end)),
      ...parseDoc(comment),
      members,
    };
  });

  return { experimental: !!opening?.[0].includes("@experimental"), declarations };
}
