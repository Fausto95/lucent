import * as stylex from "@stylexjs/stylex";
import { styles } from "./CodeBlock.stylex";
import { HighlightedCode } from "./HighlightedCode";
import { useClipboard } from "./ClipboardProvider";

export function CodeBlock({ filename, code }: { filename: string; code: string }) {
  const { copy } = useClipboard();
  return (
    <div {...stylex.props(styles.referenceCode)}>
      <div {...stylex.props(styles.referenceCodeBar)}>
        <span {...stylex.props(styles.referenceFileName)}>{filename}</span>
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
