import * as stylex from "@stylexjs/stylex";
import type { DocGroup, DocPage } from "../docs/types";
import { styles } from "./DocsLayout.stylex";
import { styles as content } from "./DocsContent.stylex";
import { DocsBlock } from "./DocsBlock";
import { DocsPager } from "./DocsPager";
import { DocsSidebar } from "./DocsSidebar";
import { DocsToc } from "./DocsToc";
import { Inline } from "./Inline";
import { useDocumentMeta } from "./useDocumentMeta";
import { useScrollToHash } from "./useScrollToHash";

interface DocsLayoutProps {
  groups: DocGroup[];
  group: DocGroup;
  page: DocPage;
  previous?: DocPage;
  next?: DocPage;
}

/** Three columns: grouped page list, the page, and its table of contents. */
export function DocsLayout({ groups, group, page, previous, next }: DocsLayoutProps) {
  useDocumentMeta(`${page.title} — Lucent docs`, page.description);
  useScrollToHash(page.slug);
  return (
    <div {...stylex.props(styles.layout)}>
      <DocsSidebar groups={groups} current={page.slug} />
      <main id="main" {...stylex.props(styles.main)}>
        <span {...stylex.props(content.kicker)}>{group.label}</span>
        <h1 {...stylex.props(content.title)}>{page.title}</h1>
        <p {...stylex.props(content.lead)}>
          <Inline text={page.description} />
        </p>
        {page.blocks.map((block, index) => (
          <DocsBlock key={index} block={block} />
        ))}
        <a
          href="https://github.com/Fausto95/lucent/tree/main/apps/website/src/docs/pages"
          {...stylex.props(styles.editLink)}
        >
          Edit this page on GitHub ↗
        </a>
        <DocsPager previous={previous} next={next} />
      </main>
      <DocsToc page={page} />
    </div>
  );
}
