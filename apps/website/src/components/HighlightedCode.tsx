import * as stylex from "@stylexjs/stylex";
import { styles } from "./CodeBlock.stylex";

/*
 * A tiny tokenizer, not a grammar: enough to colour keywords, well-known
 * types, strings and comments in the short samples the site shows.
 */
const tokenStyles = {
  keyword: styles.syntaxPurple,
  type: styles.syntaxYellow,
  string: styles.syntaxGreen,
  comment: styles.syntaxComment,
};
const types = new Set([
  "number",
  "string",
  "boolean",
  "void",
  "Promise",
  "Uint8Array",
  "Record",
  "Map",
  "Set",
  "Error",
  "double",
  "bool",
  "auto",
  "Ref",
  "Point",
]);
const keywords = new Set([
  "export",
  "declare",
  "class",
  "abstract",
  "extends",
  "implements",
  "constructor",
  "this",
  "super",
  "private",
  "import",
  "type",
  "interface",
  "from",
  "function",
  "async",
  "await",
  "return",
  "if",
  "else",
  "for",
  "of",
  "while",
  "const",
  "let",
  "throw",
  "try",
  "catch",
  "new",
  "null",
  "undefined",
  "true",
  "false",
  "namespace",
  "#include",
]);

export function HighlightedCode({
  code,
  reference = false,
}: {
  code: string;
  reference?: boolean;
}) {
  const tokens = code.split(/(\/\/[^\n]*|"[^"\n]*"|'[^'\n]*'|@\w+|\b\w+\b)/g);
  return (
    <code {...stylex.props(reference && styles.referenceCodeText)}>
      {tokens.map((token, index) => {
        const kind = token.startsWith("//")
          ? "comment"
          : types.has(token)
            ? "type"
            : keywords.has(token) || token.startsWith("@")
              ? "keyword"
              : token.startsWith('"') || token.startsWith("'")
                ? "string"
                : null;
        return kind ? (
          <span key={index} {...stylex.props(tokenStyles[kind])}>
            {token}
          </span>
        ) : (
          token
        );
      })}
    </code>
  );
}
