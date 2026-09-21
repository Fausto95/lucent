import * as stylex from "@stylexjs/stylex";
import { styles } from "./CodeBlock.stylex";
import { useClipboard } from "./ClipboardProvider";

const tokenStyles = {
  keyword: styles.syntaxPurple,
  type: styles.syntaxYellow,
  string: styles.syntaxGreen,
};
const types = new Set(["number", "string", "boolean", "void", "Promise", "int32", "Double"]);
const keywords = new Set([
  "export",
  "import",
  "type",
  "from",
  "function",
  "func",
  "fun",
  "async",
  "await",
  "return",
  "if",
  "else",
  "for",
  "of",
  "const",
  "let",
  "throw",
  "throws",
  "new",
  "null",
  "undefined",
]);

export function HighlightedCode({ code, reference = false }: { code: string; reference?: boolean }) {
  const tokens = code.split(/("[^"\n]*"|\b\w+\b)/g);
  return (
    <code {...stylex.props(reference && styles.referenceCodeText)}>
      {tokens.map((token, index) => {
        const kind = types.has(token)
          ? "type"
          : keywords.has(token)
            ? "keyword"
            : token.startsWith('"')
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

export function CodeBlock({ filename, code }: { filename: string; code: string }) {
  const { copy } = useClipboard();
  return (
    <div {...stylex.props(styles.referenceCode)}>
      <div {...stylex.props(styles.referenceCodeBar)}>
        <span>{filename}</span>
        <button
          type="button"
          aria-label={`Copy ${filename}`}
          onClick={() => copy(code)}
          {...stylex.props(styles.referenceCopyButton)}
        >
          Copy <span aria-hidden="true">⧉</span>
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${filename} example`} {...stylex.props(styles.referencePre)}>
        <HighlightedCode code={code} reference />
      </pre>
    </div>
  );
}
