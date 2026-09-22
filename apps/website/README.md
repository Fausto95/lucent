# Lucent website

A React 19 app built with Vite+, StyleX, and TanStack Router. It belongs to
the repository's pnpm workspace and uses the root `pnpm-lock.yaml`.

From the repository root:

```sh
pnpm install
pnpm --filter @lucent-lang/website dev
```

Open http://127.0.0.1:5173. Routes:

| Path                     | Page                                                   |
| ------------------------ | ------------------------------------------------------ |
| `/`                      | Home                                                   |
| `/docs/`                 | Introduction (Guide)                                   |
| `/docs/<slug>/`          | Every docs page; see `src/docs/nav.ts` for the list    |
| `/language/`, `/get-started/` | Redirect to their docs pages (pre-docs URLs)      |

## Checks and production

```sh
pnpm --filter @lucent-lang/website typecheck
pnpm --filter @lucent-lang/website build
pnpm --filter @lucent-lang/website preview
```

Deploy `dist/` to a static host with an SPA fallback that serves `index.html`
for application routes. `public/_redirects` and the root `vercel.json` supply
that rewrite. Do not edit `dist/`; each build replaces it.

## Vercel

Import this repository with the **Root Directory set to the repository root**
(`.`), not `apps/website`. The root `vercel.json` sets the build command
(`pnpm run website:build`), the dev command, and the output directory
(`apps/website/dist`). pnpm is pinned by the root `packageManager` field.

## Source

- `index.html`: the shell, favicon, description and Open Graph tags. Page
  components update title/description/OG at runtime through
  `useDocumentMeta`.
- `src/router.tsx`: routes, redirects, and the not-found page.
- `src/pages/HomePage.tsx`, `src/pages/DocsPage.tsx`: the two route components.
- `src/docs/types.ts`: the docs block model. A page is data: paragraphs with a
  tiny inline markup (`` `code` ``, `**strong**`, `[text](href)`), code blocks,
  tabbed code, tables, notes, lists, steps, cards, and diagrams.
- `src/docs/pages/**`: one file per docs page. `src/docs/nav.ts` is the single
  source of truth for sidebar order, prev/next, and slug lookup.
- `src/components/Docs*.tsx`: layout (sidebar, table of contents, pager) and
  the block renderer. One component per file.
- `src/components/diagrams/*.tsx`: hand-laid SVG diagrams for "How it works"
  and "Native views", built from a few primitives (`DiagramBox`,
  `DiagramArrow`, …) with the site palette.
- `*.stylex.ts` beside each component: its styles and responsive breakpoints.
- `src/styles/tokens.stylex.ts`: every colour, as StyleX `defineVars` roles
  (background, surface, border, text, accent, syntax…). Defaults are dark and
  follow `prefers-color-scheme`; `darkTheme` / `lightTheme` are `createTheme`
  overrides for an explicit choice. Style files and the SVG diagrams reference
  tokens only. `reset.css` repeats the two canvas colours for the pre-hydration
  paint and the focus ring, which needs a descendant selector.
- `src/components/ThemeProvider.tsx`: owns the preference (`localStorage`
  `lucent-theme`, else the OS), and is the only writer of the theme class on
  `<html>`, `data-theme`, and the `theme-color` meta tag. `ThemeToggle` in the
  header flips between light and dark.
- `src/content.ts`: the homepage's prewritten compiler output and samples.
- `og.svg`: source of `public/og.png` (1200×630). Regenerate with Quick Look:
  wrap the artwork in a 1200×1200 canvas offset by 285px, `qlmanage -t -s 1200`,
  then `sips -c 630 1200`.

Keep the docs aligned with `docs/language.md` and code samples with
`fixtures/` and `apps/*-example` when the language changes.
