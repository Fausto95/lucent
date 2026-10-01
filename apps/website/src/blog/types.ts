import type { Block } from "../docs/types";

/**
 * A blog post's metadata; blog/posts.ts lists these. Like a docs page, the
 * post's blocks live in their own file, `pages/<slug>.ts`, loaded when the
 * post is visited, so scripts/website.ts checks its samples, links and
 * prose the same way.
 */
export interface PostEntry {
  /** Path under /blog/, without slashes. */
  slug: string;
  title: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  /** One or two sentences for the list of posts. Also the <meta name="description">. */
  summary: string;
  /**
   * The post's samples include components drawn with SwiftUI and Compose
   * (`.lucent.tsx`): they compile with the components' views generated.
   */
  views?: true;
  /** The post's link-preview image, 1200×630, under public/ (e.g. `/blog/<slug>/og.png`); else the site's. */
  image?: string;
  /** What the image shows, for readers who can't see it. */
  imageAlt?: string;
}

/** What a post file exports. */
export interface PostModule {
  blocks: Block[];
}

export interface Post extends PostEntry {
  blocks: Block[];
}

/** The file holding a post's blocks, relative to src/blog/. */
export const postFile = (slug: string): string => `pages/${slug}.ts`;

const longDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** "2026-09-30" → "September 30, 2026", the same in every time zone. */
export const formatDate = (date: string): string => longDate.format(new Date(`${date}T00:00:00Z`));
