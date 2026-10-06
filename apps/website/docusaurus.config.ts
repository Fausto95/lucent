/**
 * The site at lucent-lang.dev: the homepage, the docs and the blog, built
 * with Docusaurus as reactnative.dev is. src/docs/nav.ts lists the docs'
 * sections: each is a navbar item with its own sidebar.
 */
import fs from "node:fs";
import path from "node:path";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { createRequire } from "node:module";
import { SITE } from "./src/blog/meta.ts";
import { expressiveCode } from "./src/docs/expressive-code.ts";
import { docsSections, slugsOf } from "./src/docs/nav.ts";
import { remarkFormat, remarkInclude, remarkSeeCpp, remarkVersion } from "./src/docs/remark.ts";
import { docsHref } from "./src/docs/types.ts";

const GITHUB = "https://github.com/Fausto95/lucent";

/**
 * Expressive Code, loaded by Node itself: Docusaurus loads this file through
 * jiti as CommonJS, and Expressive Code's ES modules load themes and
 * grammars with import(), which jiti's transform breaks.
 */
const { default: rehypeExpressiveCode, createRenderer } = createRequire(__filename)(
  "rehype-expressive-code",
) as typeof import("rehype-expressive-code");

export default async function createConfig(): Promise<Config> {
  const remarkPlugins = [remarkInclude, remarkVersion, remarkFormat, remarkSeeCpp];

  // Expressive Code's styles and scripts are the same on every page: they load
  // once, as a stylesheet and a client module, instead of inside each page.
  const renderer = await createRenderer(expressiveCode);
  const ecDir = path.join(__dirname, "node_modules/.cache/lucent-expressive-code");
  fs.mkdirSync(ecDir, { recursive: true });
  fs.writeFileSync(path.join(ecDir, "styles.css"), renderer.baseStyles + renderer.themeStyles);
  // Client modules load on the server too, where the copy buttons have no document.
  fs.writeFileSync(
    path.join(ecDir, "scripts.js"),
    `if (typeof document !== "undefined") {\n${renderer.jsModules.join("\n")}\n}\n`,
  );
  const codeBlocks = [
    rehypeExpressiveCode,
    {
      ...expressiveCode,
      customCreateRenderer: () => ({ ...renderer, baseStyles: "", themeStyles: "", jsModules: [] }),
    },
  ];

  return {
    title: "Lucent",
    tagline: "Native logic and views for React Native, written in TypeScript.",
    favicon: "favicon.svg",
    url: SITE,
    baseUrl: "/",
    trailingSlash: true,
    organizationName: "Fausto95",
    projectName: "lucent",
    onBrokenLinks: "throw",
    onBrokenAnchors: "throw",
    markdown: { format: "mdx", hooks: { onBrokenMarkdownLinks: "throw" } },
    i18n: { defaultLocale: "en", locales: ["en"] },

    presets: [
      [
        "classic",
        {
          docs: {
            path: "src/content/docs/docs",
            routeBasePath: "docs",
            sidebarPath: "./sidebars.ts",
            editUrl: `${GITHUB}/edit/main/apps/website/`,
            remarkPlugins,
            rehypePlugins: [codeBlocks],
            breadcrumbs: true,
          },
          blog: {
            path: "src/content/blog",
            routeBasePath: "blog",
            blogTitle: "Lucent blog",
            blogDescription: "News and write-ups from the Lucent project.",
            blogSidebarTitle: "All posts",
            blogSidebarCount: "ALL",
            postsPerPage: "ALL",
            showReadingTime: true,
            editUrl: `${GITHUB}/edit/main/apps/website/`,
            onUntruncatedBlogPosts: "ignore",
            remarkPlugins,
            rehypePlugins: [codeBlocks],
            feedOptions: {
              type: "rss",
              title: "Lucent blog",
              description: "News and write-ups from the Lucent project.",
            },
          },
          pages: { remarkPlugins, rehypePlugins: [codeBlocks] },
          theme: {
            customCss: ["./src/css/custom.css", path.join(ecDir, "styles.css")],
          },
        } satisfies Preset.Options,
      ],
    ],

    clientModules: [path.join(ecDir, "scripts.js")],

    themes: [
      [
        "@easyops-cn/docusaurus-search-local",
        {
          hashed: true,
          docsDir: "src/content/docs/docs",
          docsRouteBasePath: "docs",
          blogDir: "src/content/blog",
          blogRouteBasePath: "blog",
          indexBlog: true,
          highlightSearchTermsOnTargetPage: true,
          searchBarShortcutHint: true,
        },
      ],
    ],

    themeConfig: {
      image: "og.png",
      metadata: [
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        {
          property: "og:image:alt",
          content: "Lucent: native modules for React Native, written in TypeScript.",
        },
      ],
      colorMode: { respectPrefersColorScheme: true },
      announcementBar: {
        id: "experimental",
        content:
          "<b>Very early and experimental.</b> The language, the generated native code and every package API change without notice. Do not use Lucent in production.",
        isCloseable: false,
      },
      navbar: {
        title: "Lucent",
        logo: { alt: "Lucent", src: "brand/lucent-mark.svg" },
        items: [
          ...docsSections.map((section) => ({
            type: "docSidebar" as const,
            sidebarId: section.dir,
            label: section.label,
            position: "left" as const,
          })),
          { to: "/blog/", label: "Blog", position: "left" },
          {
            href: GITHUB,
            position: "right",
            className: "navbar-github-link",
            "aria-label": "GitHub",
          },
        ],
      },
      docs: { sidebar: { hideable: false, autoCollapseCategories: false } },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      footer: {
        style: "light",
        links: [
          {
            title: "Docs",
            items: docsSections.map((section) => ({
              label: section.label,
              to: docsHref(slugsOf([section])[0]!),
            })),
          },
          {
            title: "More",
            items: [
              { label: "Blog", to: "/blog/" },
              { label: "GitHub", href: GITHUB },
            ],
          },
        ],
        copyright: `Lucent is open source under the MIT license.`,
      },
    } satisfies Preset.ThemeConfig,
  };
}
