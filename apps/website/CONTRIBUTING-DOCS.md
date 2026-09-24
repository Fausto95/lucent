# Writing Lucent's docs

These rules apply to every page under `src/docs/pages`. `pnpm exec tsx
scripts/website.ts` checks them; CI runs the same script with `--check`.

## The four kinds of page

| Kind | Reader's question | Style | Length budget |
| --- | --- | --- | --- |
| Start | "What is this, and can I get it running?" | Short, linear, no choices | 400 words, 60 code lines |
| Learn | "How do I think in Lucent?" | Read in order | 800 words, 120 code lines |
| Guide | "How do I do X?" | One task, read in any order | 400 words, 60 code lines |
| Reference | "What exactly is the rule?" | Tables and generated lists | none |

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
   bindgen, emitter, lowering): say what the user sees.
6. **One name per thing.** Use the glossary below and nothing else.
7. **Honest limits.** A page that touches a limitation states it in one line
   and links to [the roadmap](/docs/roadmap/). No "coming soon" paragraphs.
8. **Every sample is real.** Samples compile in CI; runnable ones run in CI.
   No `// ...` hiding code the reader needs to copy.
9. **Every page ends with one "Next" link.** Not a list.

## Page template

A page is an entry in `src/docs/nav.ts` and a file of blocks at
`src/docs/pages/<slug>.ts`. Both are typed data (`src/docs/types.ts`), not
Markdown. The nav holds what the sidebar and search need; the file is loaded
when the page is visited.

```ts
// src/docs/nav.ts
{
  slug: "guides/call-an-ios-api",
  kind: "guide",
  title: "Call an iOS API",                                  // the task or question
  description: "Import the framework from lucent:ios and call it.", // the answer, shown first
}
```

```ts
// src/docs/pages/guides/call-an-ios-api.ts
export const blocks: Block[] = [
  { kind: "code", filename: "battery.lucent.ts", code: `…` }, // the smallest complete example
  { kind: "p", text: "…" },                                // only what the code doesn't say
  { kind: "note", tone: "warn", text: "…" },               // optional: the most common mistake
];
```

The template renders the title, the description, the blocks, then the one
"Next" link: the following page in the nav, or the entry's `next`.
`scripts/website.ts` writes the TanStack Router route of each page and
redirect (`src/generated/docs-routes.ts`), so links to docs pages type-check.
A removed page gets an entry in `src/docs/redirects.ts`.

## Samples

- A `code` block whose filename ends in `.lucent.ts` compiles. A page's
  samples compile together, as one app, so they can import each other.
- `expect: "LUCENT0xx"` marks a sample that must fail with that code. It
  compiles on its own.
- `cpp: true` adds "See the C++" under a sample: the file the compiler
  writes for it, generated into `src/generated/cpp/` when the site is
  built. Use it on the Start, Learn and How Lucent works examples.
- `copy: false` hides the copy button, for output the reader reads rather
  than runs.

## Glossary

Use exactly these terms.

| Term | Meaning |
| --- | --- |
| module | one `.lucent.ts` file and what it exports |
| shared module | a module with no platform imports |
| platform branch | `if (PLATFORM === "ios")` inside one module (`PLATFORM` from `lucent:platform`) |
| platform file | `x.ios.lucent.ts` / `x.android.lucent.ts`, the opt-in alternative to branches |
| declaration file | the shared `x.lucent.ts` that platform files implement |
| the boundary | where JS calls into Lucent and back |
| Lucent thread | the background thread async Lucent code runs on |
| main context | code allowed to call main-thread-only APIs: inside `main()` or a main-thread callback |
| native package | what `lucent build` writes to `.lucent/native` |
| SDK bindings | the typed view of iOS/Android APIs imported through `lucent:ios/*` and `lucent:android/*` |

Not "Lucent file", "native module file", "bridge", "the native side" or
"generated package".

## Checks

```sh
pnpm exec tsx scripts/website.ts   # regenerate, compile samples, write prose, run Vale
vale apps/website/.prose           # Vale alone, on the last written prose
```

`scripts/website.ts` writes each page's prose as Markdown to
`apps/website/.prose/` (not committed) and runs Vale on it with
`apps/website/.vale.ini`. Vale's rules live in `apps/website/.vale/Lucent/`.
Install Vale with `brew install vale`.
