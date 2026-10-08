# Lucent website

The site at lucent-lang.dev: the homepage, the docs and the blog, built with
[Docusaurus](https://docusaurus.io), as [reactnative.dev](https://reactnative.dev)
is. It belongs to the repository's pnpm workspace and uses the root
`pnpm-lock.yaml`.

From the repository root:

```sh
pnpm install
pnpm website          # http://127.0.0.1:3000
```

| Path                      | Page                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `/`                       | Home (`src/pages/index.tsx`)                               |
| `/docs/`                  | What is Lucent, the first page of the Guides section       |
| `/docs/<slug>/`           | Every docs page; `src/docs/nav.ts` lists them              |
| `/blog/`, `/blog/<slug>/` | Every post, newest first; one per `src/content/blog/`      |
| `/blog/rss.xml`           | The blog's feed                                            |
| `/schemas/<name>.json`    | The JSON schemas of `lucent.json` and the `--json` outputs |

A removed or renamed page gets no redirect: until Lucent is production
grade the docs change with it, and the checks keep every link in the
repository pointing at a page that exists.

## Checks and production

```sh
node scripts/website.ts            # regenerate, compile every sample, check links, budgets, prose
pnpm --filter @lucent-lang/website typecheck
pnpm website:build                 # build/, with the search index; fails on a broken link
pnpm --filter @lucent-lang/website serve
```

Vercel builds from the repository root (`vercel.json`: `pnpm run
website:build`, output `apps/website/build`). `vercel.json`'s `redirects`
are generated from `src/docs/redirects.ts`: each docs URL the site used to
serve, to the page that replaced it. `docusaurus serve` doesn't apply them.

## Source

- `docusaurus.config.ts`: the docs, blog and pages plugins, the navbar (one
  item per section of `src/docs/nav.ts`), the search, the remark plugins and
  the code blocks. `sidebars.ts` gives each section its sidebar
  (`sidebarsOf` in nav.ts).
- `src/content/docs/docs/**.mdx`: the docs pages.
  [CONTRIBUTING-DOCS.md](CONTRIBUTING-DOCS.md) says how to write one.
- `src/content/blog/*.mdx`: the posts, which Docusaurus' blog lists, renders
  and puts in the feed.
- `src/docs/types.ts`: the docs block model the checks read. `mdx-read.ts`
  reads a page into blocks, `mdx-write.ts` writes the reference pages from
  `src/docs/templates/`, and `markdown.ts` holds the conventions both
  follow, with `remark.ts` (`include`, the Lucent version, Oxfmt for
  TypeScript and JavaScript samples, "See the C++") for the build.
- `src/docs/expressive-code.ts`: code blocks, rendered by
  [Expressive Code](https://expressive-code.com) with the look the site has
  always had; its styles and scripts load once (docusaurus.config.ts).
- `src/theme/MDXComponents.tsx`: the components every page can use without
  importing them (`src/components/mdx/`: Tabs, Steps, CardGrid, LinkCard,
  Diagram, Comparison). The diagrams are hand-laid SVG in
  `src/components/diagrams/`.
- `src/pages/index.tsx` and `src/components/home/`: the homepage.
- `src/css/custom.css`: Lucent's colors and fonts on Docusaurus' theme, and
  the code frames and tabs.
- `src/generated/`: written by `scripts/website.ts`, never by hand: the
  reference pages' data, the C++ "See the C++" shows (`cpp/`), the files
  pages include (`snippets/`) and the list of posts. CI fails when they are
  stale.
- `og.svg`: source of `static/og.png` (1200×630). Regenerate with Quick Look:
  wrap the artwork in a 1200×1200 canvas offset by 285px, `qlmanage -t -s 1200`,
  then `sips -c 630 1200`.

The site is for people using Lucent, and its Architecture › Internals pages
for people working on it; `docs/` in the repository keeps the contributor
docs and design records.
