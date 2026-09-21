# Lucent website

A React 19 app built with Vite 8, StyleX, and TanStack Router. It belongs to
the repository's Bun workspace and uses the root `bun.lock`.

From the repository root:

```sh
bun install
bun run --cwd apps/website dev
```

Open http://127.0.0.1:5173. Vite uses its default development port and provides
React Fast Refresh. The homepage is `/`; the language reference is `/language/`.

## Checks and production

```sh
bun run --cwd apps/website typecheck
bun run --cwd apps/website build
bun run --cwd apps/website preview
```

The production preview uses Vite's default port, http://127.0.0.1:4173.
Deploy the generated `dist/` directory to a static host with an SPA fallback
that serves `index.html` for application routes such as `/language/`.
`public/_redirects` supplies this rewrite for compatible hosts.
Do not edit `dist/`; each build replaces it.

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
