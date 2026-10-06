import Link from "@docusaurus/Link";
import { posts } from "@site/src/generated/posts";

/** The band under the header: Lucent's status and the newest post. */
export function BlogAnnouncement() {
  const latest = posts.at(0);

  return (
    <div className="hero-announcement">
      <span className="hero-status">EXPERIMENTAL</span>
      <Link className="hero-blog" to={latest ? `/blog/${latest.slug}/` : "/blog/"}>
        <span>
          <span className="news-label">LATEST FROM THE BLOG</span>
          <span className="news-title">{latest?.title ?? "Read the Lucent blog"}</span>
        </span>
        <span className="news-action">Read the announcement ↗</span>
      </Link>
    </div>
  );
}
