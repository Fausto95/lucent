import * as stylex from "@stylexjs/stylex";
import { docsHref, type DocPage } from "../docs/types";
import { styles } from "./DocsLayout.stylex";
import { SmartLink } from "./SmartLink";

/** Previous / next links following the sidebar order. */
export function DocsPager({ previous, next }: { previous?: DocPage; next?: DocPage }) {
  return (
    <nav aria-label="Previous and next page" {...stylex.props(styles.pager)}>
      {previous && (
        <SmartLink href={docsHref(previous.slug)} {...stylex.props(styles.pagerLink)}>
          <span {...stylex.props(styles.pagerLabel)}>← PREVIOUS</span>
          {previous.title}
        </SmartLink>
      )}
      {next && (
        <SmartLink href={docsHref(next.slug)} {...stylex.props(styles.pagerLink, styles.pagerNext)}>
          <span {...stylex.props(styles.pagerLabel)}>NEXT →</span>
          {next.title}
        </SmartLink>
      )}
    </nav>
  );
}
