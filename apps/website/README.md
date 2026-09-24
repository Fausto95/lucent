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
| retired `/docs/<slug>/`  | Redirect to their replacement (`src/docs/redirects.ts`) |

## Checks and production

```sh
node scripts/website.ts            # regenerate src/generated, compile every sample
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
- `src/docs/types.ts`: the docs block model. A page is plain data with no
  React imports: paragraphs with a tiny inline markup (`` `code` ``,
  `**strong**`, `[text](href)`), code blocks, tabbed code, tables, notes,
  lists, steps, cards, and diagrams (by name). Every `*.lucent.ts` sample
  must compile; a sample showing a rejected program sets `expect` to its
  diagnostic code.
- `src/docs/pages/**`: one file per docs page. `src/docs/nav.ts` is the single
  source of truth for sidebar order, prev/next, and slug lookup.
- `src/components/Docs*.tsx`: layout (sidebar, table of contents, pager) and
  the block renderer. One component per file.
- `src/components/diagrams/*.tsx`: hand-laid SVG diagrams (the build
  pipeline, where code runs), built from a few primitives (`DiagramBox`,
  `DiagramArrow`, …) with the site palette. `DocsDiagram` maps names to them.
- `src/docs/redirects.ts`: retired slugs and their replacements.
- `src/docs/comparison-table.ts`: the comparison table, shared by the
  comparison page and the homepage.
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
- `src/content.ts`: the homepage's hand-written samples.
- `src/generated/`: written by `scripts/website.ts`, never by hand: the
  homepage's C++ (the compiler's real output for `geo.lucent.ts`) and the
  diagnostic codes (from `packages/compiler/src/diagnostics.ts`). CI fails
  when they are stale.
- `og.svg`: source of `public/og.png` (1200×630). Regenerate with Quick Look:
  wrap the artwork in a 1200×1200 canvas offset by 285px, `qlmanage -t -s 1200`,
  then `sips -c 630 1200`.

The site is for people using Lucent; `docs/` in the repository is for
people working on it. Keep the Language pages consistent with
`docs/semantics.md`; CI keeps the samples compiling.
