import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightThemeSix from "@six-tech/starlight-theme-six";
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { docsGroups } from "./src/docs/nav.ts";
import { docsRedirects } from "./src/docs/redirects.ts";
import { docsHref } from "./src/docs/types.ts";
import { remarkFormat, remarkInclude, remarkSeeCpp } from "./src/docs/remark.ts";
import { pluginNoCopy } from "./src/docs/expressive-code.ts";
import { SITE } from "./src/blog/meta.ts";

/** Retired docs slugs, and the URLs from before /docs/, to the pages that replaced them. */
const redirects = {
  ...Object.fromEntries(
    Object.entries(docsRedirects).map(([from, to]) => [docsHref(from), docsHref(to)]),
  ),
  "/language/": "/docs/reference/language/",
  "/get-started/": "/docs/install/",
};

export default defineConfig({
  site: SITE,
  trailingSlash: "always",
  redirects,
  markdown: {
    // Pages say what they mean in straight quotes: they often quote code.
    processor: unified({
      remarkPlugins: [remarkInclude, remarkFormat, remarkSeeCpp],
      smartypants: false,
    }),
  },
  integrations: [
    starlight({
      title: "Lucent",
      description:
        "Write native logic and views for React Native in TypeScript. Lucent compiles logic to C++ and toolkit JSX to SwiftUI and Jetpack Compose.",
      logo: { src: "./public/brand/lucent-mark.svg", alt: "Lucent" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Fausto95/lucent" }],
      editLink: { baseUrl: "https://github.com/Fausto95/lucent/edit/main/apps/website/" },
      lastUpdated: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      head: [
        { tag: "meta", attrs: { property: "og:image", content: `${SITE}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "Lucent: native modules for React Native, written in TypeScript.",
          },
        },
        { tag: "meta", attrs: { name: "twitter:image", content: `${SITE}/og.png` } },
        {
          tag: "link",
          attrs: {
            rel: "alternate",
            type: "application/rss+xml",
            title: "Lucent blog",
            href: "/blog/rss.xml",
          },
        },
      ],
      sidebar: docsGroups.map((group) => ({
        label: group.label,
        items: group.slugs.map((slug) => ({ slug: slug ? `docs/${slug}` : "docs" })),
      })),
      customCss: [
        "@fontsource/geist/400.css",
        "@fontsource/geist/500.css",
        "@fontsource/geist/600.css",
        "@fontsource/geist/700.css",
        "@fontsource/geist-mono/400.css",
        "@fontsource/geist-mono/500.css",
        "@fontsource/geist-pixel/400.css",
        "./src/styles/site.css",
      ],
      components: {
        Header: "./src/components/overrides/Header.astro",
        Search: "./src/components/overrides/Search.astro",
        Banner: "./src/components/overrides/Banner.astro",
        Head: "./src/components/overrides/Head.astro",
        Hero: "./src/components/overrides/Hero.astro",
        PageTitle: "./src/components/overrides/PageTitle.astro",
        Sidebar: "./src/components/overrides/Sidebar.astro",
        LastUpdated: "./src/components/overrides/LastUpdated.astro",
      },
      // Blog posts use the docs' asides (:::note) and components too.
      markdown: { processedDirs: ["./src/content/blog/"] },
      expressiveCode: {
        // A sample's first line is code, never a file name: the title says which file it is.
        frames: { extractFileNameFromCode: false },
        plugins: [pluginNoCopy()],
      },
      plugins: [
        starlightThemeSix({
          navLinks: [
            { label: "Docs", link: "/docs/" },
            { label: "Blog", link: "/blog/" },
          ],
          footerText:
            "Lucent is open source under the MIT license. [GitHub](https://github.com/Fausto95/lucent)",
        }),
      ],
    }),
    // The docs' diagrams are React components, rendered at build time: no JavaScript reaches the page.
    react(),
  ],
});
