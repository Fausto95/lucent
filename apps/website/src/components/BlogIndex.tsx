import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { posts } from "../blog/posts";
import { styles } from "./Blog.stylex";
import { styles as content } from "./DocsContent.stylex";
import { Inline } from "./Inline";
import { PostDate } from "./PostDate";
import { useDocumentMeta } from "./useDocumentMeta";

/** Every post, newest first: its date, its title and its summary. */
export function BlogIndex() {
  useDocumentMeta(
    "Blog — Lucent",
    "What's new in Lucent, and how it works: announcements from the people building it.",
  );
  return (
    <main id="main" {...stylex.props(styles.index)}>
      <h1 {...stylex.props(content.title)}>Blog</h1>
      <p {...stylex.props(content.lead)}>
        What's new in Lucent, and how it works.{" "}
        <a href="/blog/rss.xml" {...stylex.props(styles.feed)}>
          RSS
        </a>
      </p>
      <ol {...stylex.props(styles.list)}>
        {posts.map((post) => (
          <li key={post.slug} {...stylex.props(styles.item)}>
            <PostDate date={post.date} />
            <h2 {...stylex.props(styles.itemTitle)}>
              <Link
                to="/blog/$slug/"
                params={{ slug: post.slug }}
                {...stylex.props(styles.itemLink)}
              >
                {post.title}
              </Link>
            </h2>
            <p {...stylex.props(content.paragraph)}>
              <Inline text={post.summary} />
            </p>
          </li>
        ))}
      </ol>
    </main>
  );
}
