import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "./pages/HomePage";
import { docsRedirectRoutes, docsPageRoutes } from "./generated/docs-routes";
import { docsRoute } from "./routes/docs";
import { rootRoute } from "./routes/root";

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

/** The URLs from before /docs/. */
const languageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/language",
  beforeLoad: () => {
    throw redirect({ to: "/docs/language/", replace: true });
  },
});
const getStartedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/get-started",
  beforeLoad: () => {
    throw redirect({ to: "/docs/install/", replace: true });
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    docsRoute.addChildren([...docsPageRoutes, ...docsRedirectRoutes]),
    languageRoute,
    getStartedRoute,
  ]),
  trailingSlash: "always",
  scrollRestoration: true,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
