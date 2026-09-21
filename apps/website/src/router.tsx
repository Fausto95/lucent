import * as stylex from "@stylexjs/stylex";
import { createRootRoute, createRoute, createRouter, Link } from "@tanstack/react-router";
import { SiteLayout } from "./components/SiteLayout";
import { HomePage } from "./pages/HomePage";
import { LanguagePage } from "./pages/LanguagePage";
import { GetStartedPage } from "./pages/GetStartedPage";
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
const getStartedRoute = createRoute({ getParentRoute: () => rootRoute, path: "/get-started/", component: GetStartedPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, getStartedRoute, languageRoute]),
  trailingSlash: "always",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
