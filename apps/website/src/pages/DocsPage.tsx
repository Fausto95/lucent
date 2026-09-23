import * as stylex from "@stylexjs/stylex";
import { Link, Navigate, useLocation } from "@tanstack/react-router";
import { DocsLayout } from "../components/DocsLayout";
import { docsGroups, findDocPage } from "../docs/nav";
import { docsRedirects } from "../docs/redirects";
import { styles as sharedStyles } from "../styles/shared.stylex";

/** Resolves the /docs/* path to a page and renders it; retired slugs redirect, unknown ones get a small not-found. */
export function DocsPage() {
  const slug = useLocation({
    select: (location) => location.pathname.replace(/^\/docs\/?/, "").replace(/\/$/, ""),
  });
  const found = findDocPage(slug);
  const moved = docsRedirects[slug];
  if (!found && moved !== undefined) {
    return <Navigate to="/docs/$/" params={{ _splat: moved }} hash={(hash) => hash ?? ""} replace />;
  }
  if (!found) {
    return (
      <main id="main" {...stylex.props(sharedStyles.howSection)}>
        <h1>No such page.</h1>
        <Link to="/docs/$/" params={{ _splat: "" }} {...stylex.props(sharedStyles.button)}>
          Back to the docs
        </Link>
      </main>
    );
  }
  return <DocsLayout groups={docsGroups} {...found} />;
}
