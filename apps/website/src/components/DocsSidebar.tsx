import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { DocGroup } from "../docs/types";
import { styles } from "./DocsLayout.stylex";

const NARROW = "(max-width: 850px)";

/** Grouped page list. Sticky and always open on wide screens; a collapsed menu on narrow ones. */
export function DocsSidebar({ groups, current }: { groups: DocGroup[]; current: string }) {
  const [open, setOpen] = useState(() => !window.matchMedia(NARROW).matches);
  return (
    <aside {...stylex.props(styles.sidebar)}>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary {...stylex.props(styles.sidebarSummary)}>
          DOCS MENU <span aria-hidden="true">{open ? "×" : "☰"}</span>
        </summary>
        <nav aria-label="Documentation">
          {groups.map((group) => (
            <div key={group.label} {...stylex.props(styles.group)}>
              <p {...stylex.props(styles.groupLabel)}>{group.label}</p>
              {group.pages.map((page) => (
                <Link
                  key={page.slug}
                  to="/docs/$/"
                  params={{ _splat: page.slug }}
                  aria-current={page.slug === current ? "page" : undefined}
                  onClick={() => {
                    if (window.matchMedia(NARROW).matches) setOpen(false);
                  }}
                  {...stylex.props(styles.navLink, page.slug === current && styles.navLinkActive)}
                >
                  {page.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </details>
    </aside>
  );
}
