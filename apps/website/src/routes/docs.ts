import { createRoute } from "@tanstack/react-router";
import { DocsArticle } from "../components/DocsArticle";
import { DocsLayout } from "../components/DocsLayout";
import { DocsNotFound } from "../components/DocsNotFound";
import { loadBlocks } from "../docs/loadBlocks";
import { findDoc } from "../docs/nav";
import { rootRoute } from "./root";

export const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs",
  component: DocsLayout,
  notFoundComponent: DocsNotFound,
});

/** What each page's route does (src/generated/docs-routes.ts has one route per page): load its own chunk, render the template. */
export function docPage(slug: string) {
  const lookup = findDoc(slug);
  if (!lookup) throw new Error(`/docs/${slug}/ is not in the nav`);
  return {
    loader: async () => ({ lookup, blocks: await loadBlocks(slug) }),
    component: DocsArticle,
  };
}

/** A redirect keeps the URL's #anchor. */
export function keepHash(location: { hash: string }): { hash?: string } {
  return location.hash ? { hash: location.hash } : {};
}
