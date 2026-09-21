import * as stylex from "@stylexjs/stylex";
import { createRootRoute, createRoute, createRouter, Link } from "@tanstack/react-router";
import { SiteLayout } from "./components/SiteLayout";
import { HomePage } from "./pages/HomePage";
import { LanguagePage } from "./pages/LanguagePage";
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
const languageRoute = createRoute({ getParentRoute: () => rootRoute, path: "/language/", component: LanguagePage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, languageRoute]),
  trailingSlash: "always",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
