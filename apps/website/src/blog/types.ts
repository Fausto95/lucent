/** A blog post's frontmatter (Docusaurus' blog reads it), with its slug. */
export interface PostEntry {
  /** Path under /blog/, without slashes: the file's name. */
  slug: string;
  title: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  /** One or two sentences for the list of posts. Also the <meta name="description">. */
  description: string;
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

/** Newest first, the order of the list at /blog/ and of the feed. */
export const newestFirst = <T extends { date: string }>(posts: T[]): T[] =>
  [...posts].sort((a, b) => b.date.localeCompare(a.date));

const longDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** "2026-09-30" → "September 30, 2026", the same in every time zone. */
export const formatDate = (date: string): string => longDate.format(new Date(`${date}T00:00:00Z`));
