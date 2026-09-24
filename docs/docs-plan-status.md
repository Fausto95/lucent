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

- [ ] New navigation, page kinds, the page template component, redirects,
      removal of the old pages.

## 3–11

Not started.
