import type { PostEntry } from "./types";

/** Every blog post, newest first: the list at /blog/ follows this order. */
export const posts: PostEntry[] = [];

export const findPost = (slug: string): PostEntry | undefined =>
  posts.find((post) => post.slug === slug);
