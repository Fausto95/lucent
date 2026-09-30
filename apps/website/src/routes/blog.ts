import { createRoute, notFound } from "@tanstack/react-router";
import { loadPostBlocks } from "../blog/loadBlocks";
import { findPost } from "../blog/posts";
import { BlogArticle } from "../components/BlogArticle";
import { BlogIndex } from "../components/BlogIndex";
import { rootRoute } from "./root";

export const blogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/blog",
});

export const blogIndexRoute = createRoute({
  getParentRoute: () => blogRoute,
  path: "/",
  component: BlogIndex,
});

/** A post loads its own chunk; an unknown slug is the site's not-found page. */
export const blogPostRoute = createRoute({
  getParentRoute: () => blogRoute,
  path: "$slug",
  loader: async ({ params }) => {
    const entry = findPost(params.slug);
    if (!entry) throw notFound();

    return { entry, blocks: await loadPostBlocks(entry.slug) };
  },
  component: BlogArticle,
});
