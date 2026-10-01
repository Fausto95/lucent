import { getCollection } from "astro:content";
import { newestFirst, type PostEntry } from "./types";

/** Every post, newest first, with the entry Astro renders. */
export async function loadPosts() {
  const entries = await getCollection("blog");
  return newestFirst(
    entries.map((entry) => ({ ...(entry.data as Omit<PostEntry, "slug">), slug: entry.id, entry })),
  );
}

/** The blog's sidebar: the list, then every post, newest first. */
export async function blogSidebar() {
  const posts = await loadPosts();
  return [
    { label: "All posts", link: "/blog/" },
    {
      label: "Posts",
      items: posts.map((post) => ({ label: post.title, link: `/blog/${post.slug}/` })),
    },
  ];
}
