import * as stylex from "@stylexjs/stylex";
import { styles } from "./CodeBlock.stylex";
import { HighlightedCode } from "./HighlightedCode";

const lineStyle = { "+": styles.diffAdded, "-": styles.diffRemoved } as const;

/** A unified diff: added and removed lines marked, their code highlighted like any sample. */
export function DiffCode({ code }: { code: string }) {
  return (
    <code {...stylex.props(styles.referenceCodeText)}>
      {code.split("\n").map((line, i) => {
        if (line.startsWith("@@")) {
          return (
            <span key={i} {...stylex.props(styles.diffLine, styles.syntaxComment)}>
              {line.replace(/^@@[^@]*@@ ?/, "@@ ")}
            </span>
          );
        }
        const mark = line[0] === "+" || line[0] === "-" ? line[0] : " ";
        return (
          <span key={i} {...stylex.props(styles.diffLine, mark !== " " && lineStyle[mark])}>
            <span aria-hidden="true" {...stylex.props(styles.diffMark)}>
              {mark}
            </span>
            <HighlightedCode code={line.slice(1)} />
          </span>
        );
      })}
    </code>
  );
}
