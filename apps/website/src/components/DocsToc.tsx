import * as stylex from "@stylexjs/stylex";
import { headingId, type DocPage } from "../docs/types";
import { styles } from "./DocsLayout.stylex";
import { Inline } from "./Inline";
import { useActiveHeading } from "./useActiveHeading";

/** "On this page": one link per h2, highlighting the section in view. */
export function DocsToc({ page }: { page: DocPage }) {
  const headings = page.blocks.flatMap((block) => (block.kind === "h2" ? [block.text] : []));
  const ids = headings.map(headingId);
  const active = useActiveHeading(ids);
  if (headings.length < 2) return <div />;
  return (
    <aside {...stylex.props(styles.toc)}>
      <nav aria-label="On this page">
        <p {...stylex.props(styles.tocLabel)}>On this page</p>
        {headings.map((text, i) => (
          <a
            key={ids[i]}
            href={`#${ids[i]}`}
            aria-current={active === ids[i] ? "location" : undefined}
            {...stylex.props(styles.tocLink, active === ids[i] && styles.tocLinkActive)}
          >
            <Inline text={text} />
          </a>
        ))}
      </nav>
    </aside>
  );
}
