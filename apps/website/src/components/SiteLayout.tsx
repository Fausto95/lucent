import * as stylex from "@stylexjs/stylex";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { styles } from "./SiteLayout.stylex";
import { Brand } from "./Brand";
import { ClipboardProvider } from "./ClipboardProvider";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

export function SiteLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const inDocs = pathname.startsWith("/docs");
  const inApi = pathname.startsWith("/docs/api");
  const inHowItWorks = pathname.startsWith("/docs/how-it-works");
  return (
    <ThemeProvider>
      <ClipboardProvider>
        <a href="#main" {...stylex.props(styles.skipLink)}>
          Skip to content
        </a>
        <div {...stylex.props(styles.pageShell)}>
          <header {...stylex.props(styles.header)}>
            <Brand />
            <nav aria-label="Main navigation" {...stylex.props(styles.mainNav)}>
              <Link
                to="/docs/$/"
                params={{ _splat: "" }}
                {...stylex.props(styles.languageNavLink, inDocs && !inApi && !inHowItWorks && styles.activeNav)}
              >
                Docs
              </Link>
              <Link
                to="/docs/$/"
                params={{ _splat: "how-it-works" }}
                {...stylex.props(styles.overviewNavLink, inHowItWorks && styles.activeNav)}
              >
                How it works
              </Link>
              <Link
                to="/docs/$/"
                params={{ _splat: "api" }}
                {...stylex.props(styles.languageNavLink, inApi && styles.activeNav)}
              >
                API
              </Link>
              <ThemeToggle />
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
            <p {...stylex.props(styles.footerTagline)}>A little TypeScript. A lot more native.</p>
            <div {...stylex.props(styles.footerLinks)}>
              <Link to="/docs/$/" params={{ _splat: "" }} {...stylex.props(styles.footerLink)}>
                Docs
              </Link>
              <Link to="/docs/$/" params={{ _splat: "examples" }} {...stylex.props(styles.footerLink)}>
                Examples
              </Link>
              <a href="https://github.com/Fausto95/lucent" {...stylex.props(styles.footerLink)}>
                GitHub ↗
              </a>
              <span {...stylex.props(styles.footerLicense)}>Open source · MIT</span>
            </div>
          </footer>
        </div>
      </ClipboardProvider>
    </ThemeProvider>
  );
}
