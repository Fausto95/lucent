import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/** What src/docs/types.ts calls DocFrontmatter beyond Starlight's own fields. */
const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema({
    extend: z.object({
      kind: z.enum(["start", "learn", "guide", "reference", "example", "other"]).optional(),
      samplesWith: z.string().optional(),
      views: z.literal(true).optional(),
    }),
  }),
});

/** A post: src/content/blog/<slug>.mdx, at /blog/<slug>/. */
const blog = defineCollection({
  loader: glob({ pattern: "*.mdx", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    /** The day it was published, YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** One or two sentences for the list of posts. Also the <meta name="description">. */
    summary: z.string(),
    /** Its samples include components drawn with SwiftUI and Compose. */
    views: z.literal(true).optional(),
    /** The link-preview image, 1200×630, under public/; else the site's. */
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});

export const collections = { docs, blog };
