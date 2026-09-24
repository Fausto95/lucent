import * as stylex from "@stylexjs/stylex";
import { docsHref, type DocEntry } from "../docs/types";
import { styles } from "./DocsLayout.stylex";
import { Inline } from "./Inline";
import { SmartLink } from "./SmartLink";

/** The one link every page ends with. */
export function DocsNext({ entry }: { entry: DocEntry }) {
  return (
    <nav aria-label="Next page" {...stylex.props(styles.next)}>
      <SmartLink href={docsHref(entry.slug)} {...stylex.props(styles.nextLink)}>
        <span {...stylex.props(styles.nextLabel)}>NEXT →</span>
        <Inline text={entry.title} />
      </SmartLink>
    </nav>
  );
}
