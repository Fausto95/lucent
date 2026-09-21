import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./SiteLayout.stylex";
import { Brand } from "./Brand";
import { useEffect } from "react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { ClipboardProvider } from "./ClipboardProvider";
export function SiteLayout() {
  const isLanguage = useLocation({ select: (location) => location.pathname.startsWith("/language") });
  useEffect(() => {
    document.title = isLanguage ? "Language — Lucent" : "Lucent — TypeScript in. Native out.";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        isLanguage
          ? "The Lucent language reference: modules, native types, control flow, async functions, runtime semantics, and compiler diagnostics."
          : "Write TypeScript. Ship native Swift and Kotlin. Lucent is an ahead-of-time compiler for React Native, with Expo Modules and Nitro support.",
      );
  }, [isLanguage]);
  return (
    <ClipboardProvider>
      <a href="#main" {...stylex.props(styles.skipLink)}>
        Skip to content
      </a>
      <div {...stylex.props(styles.pageShell)}>
        <header {...stylex.props(styles.header)}>
          <Brand />
          <nav aria-label="Main navigation" {...stylex.props(styles.mainNav)}>
            <Link to="/" hash="how-it-works" {...stylex.props(styles.overviewNavLink)}>
              {"How it works"}
            </Link>
            <Link to="/language/" {...stylex.props(styles.languageNavLink, isLanguage && styles.activeNav)}>
              {"Language"}
            </Link>
            <a href="https://github.com/Fausto95/lucent" {...stylex.props(styles.githubLink)}>
              {"GitHub "}
              <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.externalLinkIcon)}>
                <path d="M7 17 17 7M7 7h10v10"></path>
              </svg>
            </a>
          </nav>
        </header>
        <Outlet />
        <footer {...stylex.props(styles.footer)}>
          <Brand compact />
          <p {...stylex.props(styles.footerTagline)}>{"A little TypeScript. A lot more native."}</p>
          <div {...stylex.props(styles.footerLinks)}>
            <a href="https://github.com/Fausto95/lucent" {...stylex.props(styles.footerLink)}>
              {"GitHub ↗"}
            </a>
            <span {...stylex.props(styles.footerLicense)}>{"Open source · MIT"}</span>
          </div>
        </footer>
      </div>
    </ClipboardProvider>
  );
}
