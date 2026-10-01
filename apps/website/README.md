# Lucent website

The site at lucent-lang.dev: the homepage, the docs and the blog, built with
[Astro](https://astro.build) and [Starlight](https://starlight.astro.build)
in the [Six](https://github.com/six-tech/Six.StarlightTheme) theme. It
belongs to the repository's pnpm workspace and uses the root `pnpm-lock.yaml`.

From the repository root:

```sh
pnpm install
pnpm website          # http://127.0.0.1:4321
```

| Path                          | Page                                                    |
| ----------------------------- | ------------------------------------------------------- |
| `/`                           | Home (`src/content/docs/index.mdx`)                     |
| `/docs/`                      | What is Lucent                                          |
| `/docs/<slug>/`               | Every docs page; `src/docs/nav.ts` lists them           |
| `/blog/`, `/blog/<slug>/`     | Every post, newest first; one per `src/content/blog/`   |
| `/blog/rss.xml`               | The blog's feed                                         |
| `/language/`, `/get-started/` | Redirect to their docs pages (pre-docs URLs)            |
| retired `/docs/<slug>/`       | Redirect to their replacement (`src/docs/redirects.ts`) |

## Checks and production

```sh
node scripts/website.ts            # regenerate, compile every sample, check links, budgets, prose
pnpm --filter @lucent-lang/website typecheck
pnpm website:build                 # dist/, with the search index
pnpm --filter @lucent-lang/website preview
```

Vercel builds from the repository root (`vercel.json`: `pnpm run
website:build`, output `apps/website/dist`).

## Source

- `astro.config.ts`: Starlight, the Six theme, the sidebar (from
  `src/docs/nav.ts`), redirects, and the remark plugins.
- `src/content/docs/docs/**.mdx`: the docs pages.
  [CONTRIBUTING-DOCS.md](CONTRIBUTING-DOCS.md) says how to write one.
- `src/content/blog/*.mdx`: the posts. `src/pages/blog/` lists them,
  renders each, and writes the feed (`src/blog/feed.ts`).
- `src/docs/types.ts`: the docs block model the checks read. `mdx-read.ts`
  reads a page into blocks, `mdx-write.ts` writes the reference pages from
  `src/docs/templates/`, and `markdown.ts` holds the conventions both
  follow, with `remark.ts` (`include`, "See the C++") for the build.
- `src/components/`: `Diagram.astro` (the hand-laid SVG diagrams in
  `diagrams/`, rendered at build time), `Comparison.astro`, `Feature.astro`,
  and `overrides/` of Starlight's components (the experimental banner, the
  page title, "Verified with Lucent").
- `src/styles/site.css`: the Geist fonts, and additions to the theme.
- `src/generated/`: written by `scripts/website.ts`, never by hand: the
  reference pages' data, the C++ "See the C++" shows (`cpp/`), and the
  files pages include (`snippets/`). CI fails when they are stale.
- `patches/@six-tech__starlight-theme-six@*.patch` (repository root): two
  fixes to the theme's CSS, an invalid selector and a container that never
  narrowed.
- `og.svg`: source of `public/og.png` (1200×630). Regenerate with Quick Look:
  wrap the artwork in a 1200×1200 canvas offset by 285px, `qlmanage -t -s 1200`,
  then `sips -c 630 1200`.

The site is for people using Lucent; `docs/` in the repository is for
people working on it. Keep the language pages consistent with
`docs/semantics.md`; CI keeps the samples compiling.
