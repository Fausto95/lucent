import { createRoute, createRouter, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { docsRedirectRoutes, docsPageRoutes } from "./generated/docs-routes";
import { docsRoute } from "./routes/docs";
import { rootRoute } from "./routes/root";

// The homepage is its own chunk: docs pages don't load it.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./pages/HomePage"), "HomePage"),
});

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
