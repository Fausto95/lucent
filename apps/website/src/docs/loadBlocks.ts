import { type Block, docFile, type DocModule } from "./types";

// One chunk per page, so a visit loads only the page it shows.
const modules = import.meta.glob<DocModule>("./pages/**/*.ts");

export async function loadBlocks(slug: string): Promise<Block[]> {
  const load = modules[`./${docFile(slug)}`];
  if (!load) throw new Error(`/docs/${slug}/ has no ${docFile(slug)}`);
  return (await load()).blocks;
}
