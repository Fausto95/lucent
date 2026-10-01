import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const website = path.join(root, "apps/website");
export const websiteSrc = path.join(website, "src");
/** Docs pages: <slug>.mdx, index.mdx for the empty slug. */
export const docsContent = path.join(websiteSrc, "content/docs/docs");
/** Blog posts: <slug>.mdx. */
export const blogContent = path.join(websiteSrc, "content/blog");

/** The URL of a docs page, as problems name it. */
export const where = (slug: string): string => `/docs/${slug}${slug ? "/" : ""}`;

/** A docs page's file, from the website's root. */
export const docFile = (slug: string): string => `src/content/docs/docs/${slug || "index"}.mdx`;
