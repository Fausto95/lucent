import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const websiteSrc = path.join(root, "apps/website/src");
export const docsDir = path.join(websiteSrc, "docs");

/** The URL of a docs page, as problems name it. */
export const where = (slug: string): string => `/docs/${slug}${slug ? "/" : ""}`;
