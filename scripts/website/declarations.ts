/**
 * Reads a declaration file (packages/compiler/lib/sdk/*.d.ts, lib/globals.d.ts)
 * into what the API pages show of each export: its signature, its own doc
 * comment as paragraphs and examples, its parameters and its members.
 */
import ts from "typescript";
import type {
  Declaration,
  Member,
  ModuleDeclarations,
  Param,
} from "../../apps/website/src/docs/api.ts";

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

/**
 * A comment's paragraphs and code blocks, and its @param tags by name; other
 * `@tag` lines are left out. A tag runs to the next tag or blank line.
 */
function parseDoc(text: string): {
  doc: string[];
  examples: string[];
  paramDocs: Map<string, string>;
} {
  const examples: string[] = [];
  const paramDocs = new Map<string, string>();
  let tag: string | undefined;
  const prose = text
    .replace(/```\w*\n([\s\S]*?)\n```/g, (_, code: string) => {
      examples.push(code.trimEnd());
      return "\n\n";
    })
    .split("\n")
    .filter((line) => {
      const param = /^@param\s+(\w+)\s*(.*)$/.exec(line.trim());
      if (param) {
        tag = param[1]!;
        paramDocs.set(tag, param[2]!.replace(/^-\s*/, ""));
        return false;
      }
      if (/^@\w+/.test(line.trim())) {
        tag = undefined;
        return false;
      }
      if (tag && line.trim()) {
        paramDocs.set(tag, `${paramDocs.get(tag)} ${line.trim()}`.trim());
        return false;
      }
      tag = undefined;
      return true;
    })
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
  return { doc, examples, paramDocs };
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

  /**
   * The node's own doc comment: the last before it. The file's opening
   * comment counts only when no other comment follows it.
   */
  const docOf = (node: ts.Node): string | undefined => {
    const docs = (ts.getLeadingCommentRanges(text, node.pos) ?? []).filter((r) =>
      text.startsWith("/**", r.pos),
    );
    const own = docs.length > 1 && opening && docs[0]!.pos === 0 ? docs.slice(1) : docs;
    const last = own.at(-1);
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
    const { doc, examples, paramDocs } = parseDoc(comment);
    const params = ts.isFunctionDeclaration(node)
      ? node.parameters.map((p): Param => ({
          name: p.name.getText(sf),
          type: p.type ? p.type.getText(sf) : "unknown",
          optional: !!p.questionToken || !!p.initializer,
          doc: paramDocs.get(p.name.getText(sf)) ?? "",
        }))
      : [];
    return {
      name,
      kind,
      signature: signatureOf(text.slice(node.getStart(sf), node.end)),
      doc,
      examples,
      members,
      params,
    };
  });

  return { experimental: !!opening?.[0].includes("@experimental"), declarations };
}
