import * as stylex from "@stylexjs/stylex";
import { createRootRoute, createRoute, createRouter, Link, redirect } from "@tanstack/react-router";
import { SiteLayout } from "./components/SiteLayout";
import { HomePage } from "./pages/HomePage";
import { DocsPage } from "./pages/DocsPage";
import { styles as sharedStyles } from "./styles/shared.stylex";

const rootRoute = createRootRoute({
  component: SiteLayout,
  notFoundComponent: () => (
    <main id="main" {...stylex.props(sharedStyles.howSection)}>
      <h1>Page not found.</h1>
      <Link to="/" {...stylex.props(sharedStyles.button)}>
        Back to Lucent
      </Link>
    </main>
  ),
});
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const docsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/docs/$", component: DocsPage });

/** Pre-docs URLs keep working. */
const legacyLanguageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/language/",
  beforeLoad: () => {
    throw redirect({ to: "/docs/$/", params: { _splat: "language" }, replace: true });
  },
});
const legacyGetStartedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/get-started/",
  beforeLoad: () => {
    throw redirect({ to: "/docs/$/", params: { _splat: "getting-started" }, replace: true });
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, docsRoute, legacyLanguageRoute, legacyGetStartedRoute]),
  trailingSlash: "always",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
