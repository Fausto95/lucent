import * as stylex from "@stylexjs/stylex";
import { Outlet, useLocation } from "@tanstack/react-router";
import { docsGroups } from "../docs/nav";
import { styles } from "./DocsLayout.stylex";
import { DocsSidebar } from "./DocsSidebar";

/** Three columns: the page list, then the page and its table of contents (DocsArticle). */
export function DocsLayout() {
  const slug = useLocation({ select: (location) => location.pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "") });
  return (
    <div {...stylex.props(styles.layout)}>
      <DocsSidebar groups={docsGroups} current={slug} />
      <Outlet />
    </div>
  );
}
