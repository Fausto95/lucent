# Lucent website

A React 19 app built with Vite+, StyleX, and TanStack Router. It belongs to
the repository's pnpm workspace and uses the root `pnpm-lock.yaml`.

From the repository root:

```sh
pnpm install
pnpm --filter @lucent-lang/website dev
```

Open http://127.0.0.1:5173. Vite uses its default development port and provides
React Fast Refresh. The homepage is `/`; the language reference is `/language/`.

## Checks and production

```sh
pnpm --filter @lucent-lang/website typecheck
pnpm --filter @lucent-lang/website build
pnpm --filter @lucent-lang/website preview
```

The local production preview uses Vite's default port, http://127.0.0.1:4173.
Deploy the generated `dist/` directory to a static host with an SPA fallback
that serves `index.html` for application routes such as `/language/`.
`public/_redirects` supplies this rewrite for compatible hosts.
Do not edit `dist/`; each build replaces it.

## Vercel

Import this repository into Vercel with the **Root Directory set to the repository
root** (`.`), not `apps/website`. The root `vercel.json` sets:

- Build command: `pnpm run website:build`
- Development command: `pnpm run website`
- Output directory: `apps/website/dist`

Installation uses Vercel's default pnpm detection, with pnpm 9.1.2 pinned in the
root `packageManager` field. There is no custom install command.

The SPA rewrite serves `index.html` for direct visits to routes such as
`/language/`. Vercel serves the built static files; it does not need to run
the preview server in production. The existing `build:packages` command continues
to build the compiler packages separately.

## Source

- `index.html`: the application shell, favicon, and initial metadata only.
- `src/main.tsx`: React entry point.
- `src/router.tsx`: typed TanStack routes, scroll restoration, and not-found page.
- `src/pages/`: Home and Language page components.
- `src/components/`: shared layout, code examples, clipboard feedback, and section navigation.
- `*.stylex.ts` beside each page/component: its styles, states, and responsive breakpoints.
- `src/styles/shared.stylex.ts`: the few styles used across components.
- `src/reset.css`: document defaults, fonts, focus treatment, and reduced-motion support.
- `src/content.ts`: the homepage's native examples and setup commands.

StyleX compiles styles at build time through its official Vite integration.
Internal navigation uses TanStack `Link` components; tabs and clipboard feedback
use React state. The Swift/Kotlin switcher displays prewritten compiler output,
not a live compiler. Keep the Language page aligned with `docs/language.md`
and its code examples with `fixtures/` when the language changes.
