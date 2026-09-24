# Documentation plan: status

Tracks `lucent-docs-plan.md` (the website's user docs and the repo docs):
what is done, what is left, what was postponed and why. Updated in the same
commit as the work it describes.

Decisions on the plan's open questions (2026-09-24):

- The tutorial is the trip tracker, built in `apps/tutorial`.
- Content stays typed TypeScript page objects, not MDX. Vale runs on
  Markdown that `scripts/website.ts` writes from them.
- Only the latest docs, until 1.0.
- Where the plan and the code disagree, the docs describe the code:
  - one module with `if (PLATFORM === "ios")` is the standard; platform
    files are the opt-in alternative;
  - `Weak`, `using` and `lucent sdk diff` don't exist, so the pages that
    need them state the limit and link to the roadmap;
  - the `lucent.json` reference needs a schema generated from the parser's
    types.

## 1. Writing rules and glossary

- [x] `apps/website/CONTRIBUTING-DOCS.md`: the four kinds of page with length
      budgets, the nine rules, the page template, samples, the glossary.
- [x] Vale (`apps/website/.vale.ini`, `.vale/Lucent/`): banned words,
      internal names, glossary swaps, title words, sentence length (under
      25 words), paragraph length (under 4 sentences), emoji, "coming soon".
- [x] `scripts/website.ts` writes each page's prose to
      `apps/website/.prose/` and runs Vale; CI installs Vale 3.22.
- Vale only warns on the pages written before these rules (64 findings on
  26 pages). It blocks on each new page as it lands.

Guessed (not in the plan): the length budgets in words and code lines
(Start and Guides 400 words / 60 lines, Learn 800 / 120).

## 2. Site structure

- [x] TanStack Router: one route per page, each loading its own chunk
      (1–7 KB gzipped), preloaded on hover. `scripts/website.ts` writes the
      route tree from the nav (`src/generated/docs-routes.ts`, drift-checked),
      so every docs path is a literal type and links to pages type-check.
- [x] Retired slugs are router redirects that keep the `#anchor`; the pre-docs
      URLs (`/language/`, `/get-started/`) too.
- [x] Page model: nav entries hold slug, kind, title, description and an
      optional `next`; `pages/<slug>.ts` holds the blocks. The template
      renders one "Next" link, "Edit this page" (the page's own file) and
      "Verified with Lucent x.y" (the package version at build).
- [x] Checks: page files match the nav, every page has its "Next" link,
      internal links and `#anchors` resolve. `scripts/website.ts` is split
      into modules under `scripts/website/`.
- [ ] Old pages are removed as their replacements land (they sit in a
      "Legacy" group meanwhile).
- The shared JS chunk is 117 KB gzipped (React, the router, the homepage),
  over the plan's 100 KB per page: for step 10.

## 3–11

Not started.
