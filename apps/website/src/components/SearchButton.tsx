import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useEffect, useState } from "react";
import { styles } from "./Search.stylex";

const SearchDialog = lazy(() => import("./SearchDialog").then((m) => ({ default: m.SearchDialog })));

/** Opens the docs search; "/" and ⌘K (Ctrl+K) open it from anywhere. */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" aria-label="Search the docs" onClick={() => setOpen(true)} {...stylex.props(styles.button)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.icon)}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span {...stylex.props(styles.label)}>Search</span>
        <kbd {...stylex.props(styles.key)}>/</kbd>
      </button>
      {open && (
        <Suspense fallback={null}>
          <SearchDialog open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
