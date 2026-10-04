import Link from "@docusaurus/Link";
import SearchBar from "@theme/SearchBar";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";

/**
 * The homepage's own header. On phones its links fold into a menu, closed by
 * a click outside the header, a picked link, Escape, or the screen widening.
 */
export function HomeNav() {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const close = () => setOpen(false);
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) close();
    };
    const wide = matchMedia("(min-width: 761px)");

    document.addEventListener("click", closeOutside);
    wide.addEventListener("change", close);

    return () => {
      document.removeEventListener("click", closeOutside);
      wide.removeEventListener("change", close);
    };
  }, []);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <nav ref={nav} className="wrap" aria-label="Main navigation" onKeyDown={closeOnEscape}>
      <Logo />
      <div className="navlinks">
        <SearchBar />
        <button
          ref={toggle}
          className="nav-toggle"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="home-menu"
          onClick={() => setOpen(!open)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="nav-menu" id="home-menu" onClick={() => setOpen(false)}>
          <Link to="/docs/">Docs</Link>
          <Link className="optional" to="/docs/guides/port-an-expo-module/">
            Examples
          </Link>
          <Link className="optional" to="/blog/">
            Blog
          </Link>
          <Link className="nav-start" to="/docs/guides/install/">
            Get started ↗
          </Link>
        </div>
      </div>
    </nav>
  );
}
