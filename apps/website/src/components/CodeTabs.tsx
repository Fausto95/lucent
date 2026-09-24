import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { styles as code } from "./CodeBlock.stylex";
import { styles } from "./DocsContent.stylex";
import { DiffCode } from "./DiffCode";
import { HighlightedCode } from "./HighlightedCode";
import { useClipboard } from "./ClipboardProvider";

export interface CodeTab {
  label: string;
  filename: string;
  code: string;
  diff?: boolean;
}

/** A code block with a tab per variant, e.g. the Swift and Kotlin output of one source. */
export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [index, setIndex] = useState(0);
  const { copy } = useClipboard();
  const current = tabs[index] ?? tabs[0]!;
  return (
    <div {...stylex.props(code.referenceCode)}>
      <div {...stylex.props(code.referenceCodeBar)}>
        <div role="tablist" aria-label="Variants" {...stylex.props(styles.tabList)}>
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              {...stylex.props(styles.tab, i === index && styles.tabSelected)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span {...stylex.props(code.referenceFileName, code.referenceFileNameEnd)}>{current.filename}</span>
        {!current.diff && (
          <button
            type="button"
            aria-label={`Copy ${current.filename}`}
            onClick={() => copy(current.code)}
            {...stylex.props(code.referenceCopyButton)}
          >
            Copy <span aria-hidden="true">⧉</span>
          </button>
        )}
      </div>
      <pre tabIndex={0} role="tabpanel" aria-label={current.filename} {...stylex.props(code.referencePre)}>
        {current.diff ? <DiffCode code={current.code} /> : <HighlightedCode code={current.code} reference />}
      </pre>
    </div>
  );
}
