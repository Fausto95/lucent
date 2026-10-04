# Writing Lucent's docs

These rules apply to every page under `src/content/docs/docs`, and to blog posts
as [Blog posts](#blog-posts) says. `node scripts/website.ts` checks them; CI
runs the same script with `--check`.

## Sections and kinds of page

The docs are four sections, each a tab with its own sidebar, listed in
`src/docs/nav.ts`: **Guides** (tasks, in any order after Get started),
**Packages** (writing a Lucent package), **API** (the exact rules and every
API) and **Architecture** (how Lucent works, then Internals for
contributors). A page lives under its section's directory.

| Kind        | Reader's question                         | Style                                                            | Length budget             |
| ----------- | ----------------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| Start       | "What is this, and can I get it running?" | Short, linear, read in order                                     | 400 words, 60 code lines  |
| Guide       | "How do I do X?"                          | One task, read in any order                                      | 400 words, 60 code lines  |
| Explanation | "How does this part work, and why?"       | The mechanism, linking the rules it explains                     | 800 words, 120 code lines |
| Reference   | "What exactly is the rule?"               | Tables and generated lists                                       | none                      |
| Example     | "What does a real module look like?"      | A port from the example apps, its source generated from the file | 400 words                 |
| Internals   | "How does Lucent's code do this?"         | For contributors; only under Architecture › Internals            | none                      |

Words count prose only: paragraphs, lists, notes, table cells. Code lines
count every sample on the page. A page over its budget gets split.

## Rules

1. **One page answers one question or does one task.** The title says
   which: "Call an iOS API", "How a call reaches native code". Don't use
   "Overview", "Introduction" or "Advanced" as titles.
2. **The answer comes first.** The page's `description` is the answer or the
   result. The first code block appears within the first screen.
3. **Show, then explain.** Code first, then only the sentences needed to
   understand it. If the code is obvious, write nothing.
4. **Short.** Sentences under 25 words, paragraphs under 4 sentences. Longer
   means split.
5. **Plain words.** No "simply", "just", "easy", "powerful", "seamless",
   "blazing", "robust", "leverage". No emoji. No internal names (IR, LType,
   bindgen, emitter, lowering): say what the user sees. Architecture ›
   Internals pages are for contributors and may name them.
6. **One name per thing.** Use the glossary below and nothing else.
7. **Honest limits.** A page that touches a limitation states it in one line
   and links to [the roadmap](/docs/releases/roadmap/). No "coming soon" paragraphs.
8. **Every sample is real.** Samples compile in CI; runnable ones run in CI.
   No `// ...` hiding code the reader needs to copy.
9. **"Next" stays in the section.** Each page's one "Next" link is the
   following page of its section; a section's last page has none.

## Page template

A page is an MDX file, `src/content/docs/docs/<slug>.mdx`, listed in the
sidebar in `src/docs/nav.ts`. Its frontmatter says what the page is:

````mdx
---
title: Call an iOS API # the task or question
description: Import the framework from `lucent:ios` and call it. # the answer, shown first
kind: guide # start, guide, explanation, reference, example, internals
---

```ts title="battery.lucent.ts"
…the smallest complete example
```

Only what the code doesn't say.

:::caution
Optional: the most common mistake.
:::
````

The page shows the title, the description, the content, then a "Next"
link: the following page of its section, or the frontmatter's
`next: { link, label }`, a page of the same section. A page whose samples
are views (`views: true`) sets `sidebar: { badge: "Experimental" }`: views
are behind `LUCENT_VIEWS=fabric`. A removed page gets no redirect: update
the links to it. Search (Pagefind) indexes every page when the site is
built.

A page is written in a small vocabulary, the docs blocks of
`src/docs/types.ts`, so `scripts/website.ts` can check it: paragraphs with
`code`, **strong** and [links](/docs/), `##` and `###` headings, lists,
tables, code blocks, `:::note` and `:::caution`, and these components:

| Component                                     | For                                                         |
| --------------------------------------------- | ----------------------------------------------------------- |
| `<Tabs>` of `<TabItem>`s, one code block each | variants of a sample (the module and its JS usage)          |
| `<Tabs syncKey="setup">`                      | Expo and bare React Native instructions; the choice carries |
| `<Steps>` around a numbered list of `###`s    | a procedure                                                 |
| `<CardGrid>` of `<LinkCard>`s                 | where to go next                                            |
| `<Diagram name="…">caption</Diagram>`         | the diagrams in `src/components/diagrams/`                  |
| `<Comparison />`                              | the comparison table (`src/docs/comparison-table.ts`)       |

Anything else fails the check, so it can't slip past it. The reference
pages generated from code (CLI, diagnostics, modules, `lucent.json`,
compatibility, roadmap) are written by `scripts/website.ts` from their
templates in `src/docs/templates/`: edit the template, not the MDX.

## Samples

A code block's meta names its file and what the check does with it
(`src/docs/markdown.ts`):

- `title="x.lucent.ts"`: a sample that compiles. A page's samples compile
  together, as one app, so they can import each other.
- `expect="LUCENT0xx"`: a sample that must fail with that code. It
  compiles on its own.
- `cpp`: adds "See the C++" under a sample, the file the compiler writes
  for it, generated into `src/generated/cpp/`. Use it on Get started and
  Architecture samples.
- `nocopy`: no copy button, for output the reader reads rather than runs.
- `{{lucent-version}}` in a sample becomes the current version of
  `@lucent-lang/lucent` when the site is built: write it in terminal
  output (`◆ lucent {{lucent-version}}`) rather than a number that goes
  stale.
- `include="examples/clipboard.lucent.ts"`: fills an empty block with a
  file `scripts/website.ts` writes under `src/generated/snippets/`, so a
  page shows code from the repository (the example ports) without copying
  it.
- ` ```diff lang="ts" `: a unified diff; it isn't compiled.

## Blog posts

A post is `src/content/blog/<slug>.mdx`, with a `title`, a quoted `date`
(`"2026-09-30"`) and a `summary` in its frontmatter. It is written like a
docs page. Its samples compile, its links resolve and its prose follows
these rules, but it has no length budget and no "Next" link: a post is
dated, not kept current.

A post's link preview (Open Graph and X tags) comes from its frontmatter.
Give it its own 1200×630 image with `image` (under `public/`, e.g.
`/blog/<slug>/og.png`) and `imageAlt`; without one, it uses the site's.
The blog's RSS feed, `/blog/rss.xml`, lists every post, newest first.

## Glossary

Use exactly these terms.

| Term             | Meaning                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| module           | one `.lucent.ts` file and what it exports                                                 |
| shared module    | a module with no platform imports                                                         |
| platform branch  | `if (PLATFORM === "ios")` inside one module (`PLATFORM` from `lucent:platform`)           |
| platform file    | `x.ios.lucent.ts` / `x.android.lucent.ts`, the opt-in alternative to branches             |
| declaration file | the shared `x.lucent.ts` that platform files implement                                    |
| the boundary     | where JS calls into Lucent and back                                                       |
| Lucent thread    | the background thread async Lucent code runs on                                           |
| main context     | code allowed to call main-thread-only APIs: inside `main()` or a main-thread callback     |
| native package   | what `lucent build` writes to `.lucent/native`                                            |
| SDK bindings     | the typed view of iOS/Android APIs imported through `lucent:ios/*` and `lucent:android/*` |

Not "Lucent file", "native module file", "bridge", "the native side" or
"generated package".

## Checks

```sh
node scripts/website.ts   # regenerate, compile samples, write prose, run Vale
vale apps/website/.prose           # Vale alone, on the last written prose
```

`scripts/website.ts` writes each page's prose as Markdown to
`apps/website/.prose/` (not committed) and runs Vale on it with
`apps/website/.vale.ini`. Vale's rules live in `apps/website/.vale/Lucent/`.
Install Vale with `brew install vale`.
