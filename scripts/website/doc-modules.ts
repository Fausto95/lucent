/// <reference types="vite/client" />
/**
 * Every docs page module, keyed by its path under src/docs/, and every blog
 * post module, keyed by its path under src/blog/. Loaded through Vite
 * (pages.ts), because pages import the website's modules the way the
 * website does, without extensions, which Node's resolver doesn't accept.
 */
import type { PostModule } from "../../apps/website/src/blog/types.ts";
import type { DocModule } from "../../apps/website/src/docs/types.ts";

const docs = import.meta.glob<DocModule>("../../apps/website/src/docs/pages/**/*.ts", {
  eager: true,
});

const posts = import.meta.glob<PostModule>("../../apps/website/src/blog/pages/*.ts", {
  eager: true,
});

const keyed = <T>(modules: Record<string, T>, dir: string): Record<string, T> =>
  Object.fromEntries(Object.entries(modules).map(([file, mod]) => [file.replace(dir, ""), mod]));

export const docModules: Record<string, DocModule> = keyed(docs, "../../apps/website/src/docs/");

export const postModules: Record<string, PostModule> = keyed(posts, "../../apps/website/src/blog/");
