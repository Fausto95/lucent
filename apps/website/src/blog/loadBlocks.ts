import type { Block } from "../docs/types";
import { postFile, type PostModule } from "./types";

// One chunk per post, so a visit loads only the post it shows.
const modules = import.meta.glob<PostModule>("./pages/*.ts");

export async function loadPostBlocks(slug: string): Promise<Block[]> {
  const load = modules[`./${postFile(slug)}`];
  if (!load) throw new Error(`/blog/${slug}/ has no ${postFile(slug)}`);

  return (await load()).blocks;
}
