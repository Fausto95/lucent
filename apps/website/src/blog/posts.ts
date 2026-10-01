import type { PostEntry } from "./types";

/** Every blog post, newest first: the list at /blog/ follows this order. */
export const posts: PostEntry[] = [
  {
    slug: "native-views",
    title: "Native views in TypeScript: SwiftUI and Jetpack Compose from Lucent",
    date: "2026-09-30",
    summary:
      "Lucent components now render native views: UIKit and Android views, and SwiftUI and Jetpack Compose written as JSX. One import from React, native UI on each platform, no Swift or Kotlin to write.",
    views: true,
    image: "/blog/native-views/og.png",
    imageAlt:
      "Native views in TypeScript: SwiftUI on iOS and Jetpack Compose on Android from one .lucent.tsx file, beside a like button running on iOS.",
  },
];

export const findPost = (slug: string): PostEntry | undefined =>
  posts.find((post) => post.slug === slug);
