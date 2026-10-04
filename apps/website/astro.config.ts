import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightThemeSix from "@six-tech/starlight-theme-six";
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { docsSections, headerLinks } from "./src/docs/nav.ts";
import { remarkFormat, remarkInclude, remarkSeeCpp } from "./src/docs/remark.ts";
import { pluginNoCopy } from "./src/docs/expressive-code.ts";
import { SITE } from "./src/blog/meta.ts";

export default defineConfig({
  site: SITE,
  trailingSlash: "always",
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
      // Every section, as nested groups; route-data.ts narrows each page to its own section.
      sidebar: docsSections.map((section) => ({
        label: section.label,
        items: section.groups.map((group) => ({
          label: group.label,
          items: group.slugs.map((slug) => ({ slug: slug ? `docs/${slug}` : "docs" })),
        })),
      })),
      routeMiddleware: "./src/docs/route-data.ts",
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
          // The mobile drawer's links; Header.astro draws the same as tabs.
          navLinks: headerLinks,
          footerText:
            "Lucent is open source under the MIT license. [GitHub](https://github.com/Fausto95/lucent)",
        }),
      ],
    }),
    // The docs' diagrams are React components, rendered at build time: no JavaScript reaches the page.
    react(),
  ],
});
