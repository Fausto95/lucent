import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { search, type SearchEntry } from "../docs/search";
import { styles } from "./Search.stylex";

let loaded: Promise<SearchEntry[]> | undefined;
/** The index is its own chunk, fetched the first time search opens. */
const loadIndex = () => (loaded ??= import("../generated/search-index").then((m) => m.searchIndex));

/** A modal search over the docs: type, move with the arrows, Enter to go, Esc to close. */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      void loadIndex().then(setIndex);
    }
    if (!open && element.open) element.close();
  }, [open]);

  const results = index ? search(index, query) : [];
  const go = (href: string) => {
    onClose();
    const [to, hash] = href.split("#") as [string, string | undefined];
    void navigate({ to, hash });
  };

  return (
    <dialog ref={dialog} aria-label="Search the docs" onClose={onClose} {...stylex.props(styles.dialog)}>
      <input
        type="search"
        autoFocus
        placeholder="Search the docs"
        aria-label="Search the docs"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setActive((i) => Math.min(i + 1, results.length - 1));
          else if (event.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (event.key === "Enter" && results[active]) go(results[active].href);
          else return;
          event.preventDefault();
        }}
        {...stylex.props(styles.input)}
      />
      {query.trim() && index && !results.length && <p {...stylex.props(styles.empty)}>Nothing matches “{query.trim()}”.</p>}
      {results.length > 0 && (
        <ul {...stylex.props(styles.results)}>
          {results.map((result, i) => (
            <li key={result.href}>
              <a
                href={result.href}
                aria-current={i === active ? "true" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={(event) => {
                  event.preventDefault();
                  go(result.href);
                }}
                {...stylex.props(styles.result, i === active && styles.resultActive)}
              >
                <span {...stylex.props(styles.resultTitle)}>
                  {result.page}
                  {result.heading && <span {...stylex.props(styles.resultHeading)}> › {result.heading}</span>}
                </span>
                <span {...stylex.props(styles.resultSnippet)}>{result.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
