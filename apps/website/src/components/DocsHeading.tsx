import * as stylex from "@stylexjs/stylex";
import { headingId } from "../docs/types";
import { styles } from "./DocsContent.stylex";
import { Inline } from "./Inline";

/** Section heading with a stable id and a self-link, so the table of contents and hash links agree. */
export function DocsHeading({ level, text }: { level: 2 | 3; text: string }) {
  const id = headingId(text);
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} {...stylex.props(level === 2 ? styles.h2 : styles.h3)}>
      <a href={`#${id}`} {...stylex.props(styles.headingAnchor)}>
        <Inline text={text} />
      </a>
    </Tag>
  );
}
