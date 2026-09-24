import * as stylex from "@stylexjs/stylex";
import { useLoaderData } from "@tanstack/react-router";
import type { DocLookup } from "../docs/nav";
import { type Block, docFile } from "../docs/types";
import { styles } from "./DocsLayout.stylex";
import { styles as content } from "./DocsContent.stylex";
import { DocsBlock } from "./DocsBlock";
import { DocsNext } from "./DocsNext";
import { DocsToc } from "./DocsToc";
import { Inline } from "./Inline";
import { useDocumentMeta } from "./useDocumentMeta";
import { useScrollToHash } from "./useScrollToHash";

const source = "https://github.com/Fausto95/lucent/edit/main/apps/website/src/docs/";

/** The page template: title, the answer, the blocks, one "Next" link, then where to edit it. */
export function DocsArticle() {
  const { lookup, blocks }: { lookup?: DocLookup; blocks?: Block[] } = useLoaderData({ strict: false }) ?? {};
  if (!lookup || !blocks) throw new Error("DocsArticle renders only under a docs page route");
  const { entry, group, next } = lookup;
  useDocumentMeta(`${entry.title} — Lucent docs`, entry.description);
  useScrollToHash(entry.slug);
  return (
    <>
      <main id="main" {...stylex.props(styles.main)}>
        <span {...stylex.props(content.kicker)}>{group.label}</span>
        <h1 {...stylex.props(content.title)}>
          <Inline text={entry.title} />
        </h1>
        <p {...stylex.props(content.lead)}>
          <Inline text={entry.description} />
        </p>
        {blocks.map((block, index) => (
          <DocsBlock key={index} block={block} />
        ))}
        {next && <DocsNext entry={next} />}
        <p {...stylex.props(styles.pageFooter)}>
          <a href={`${source}${docFile(entry.slug)}`} {...stylex.props(styles.editLink)}>
            Edit this page ↗
          </a>
          <span>Verified with Lucent {__LUCENT_VERSION__}</span>
        </p>
      </main>
      <DocsToc blocks={blocks} />
    </>
  );
}
