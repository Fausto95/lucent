import * as stylex from "@stylexjs/stylex";
import { getRouteApi, Link } from "@tanstack/react-router";
import { styles } from "./Blog.stylex";
import { styles as content } from "./DocsContent.stylex";
import { DocsBlock } from "./DocsBlock";
import { DocsToc } from "./DocsToc";
import { Inline } from "./Inline";
import { PostDate } from "./PostDate";
import { useDocumentMeta } from "./useDocumentMeta";
import { useScrollToHash } from "./useScrollToHash";

const route = getRouteApi("/blog/$slug");

/** A post: its date and title, its blocks (the docs' blocks), then the way back to every post. */
export function BlogArticle() {
  const { entry, blocks } = route.useLoaderData();
  useDocumentMeta(`${entry.title} — Lucent blog`, entry.summary);
  useScrollToHash(entry.slug);
  return (
    <div {...stylex.props(styles.post)}>
      <main id="main" {...stylex.props(styles.article)}>
        <PostDate date={entry.date} />
        <h1 {...stylex.props(content.title)}>
          <Inline text={entry.title} />
        </h1>
        {blocks.map((block, index) => (
          <DocsBlock key={index} block={block} />
        ))}
        <nav aria-label="Blog" {...stylex.props(styles.back)}>
          <Link to="/blog/" {...stylex.props(styles.backLink)}>
            ← All posts
          </Link>
        </nav>
      </main>
      <DocsToc blocks={blocks} />
    </div>
  );
}
