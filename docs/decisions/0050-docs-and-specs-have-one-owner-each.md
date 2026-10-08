# 0050. The website and the contributor specs each own a reader

- **Date:** 2026-10-08
- **Status:** accepted

`docs/semantics.md` and `docs/architecture.md` stay, as the specs for
people changing the compiler and runtime; the website's API › Language
and Architecture › Internals pages are for users and for contributors
reading in the browser. Where the subset tables and known gaps meet the
compiler, the website's rows are data (`apps/website/src/docs/language.ts`)
that `scripts/website.ts` checks against `codes.ts` and the e2e cases.
When the spec, the website and the compiler disagree, the e2e cases
decide, and the other two change in the same commit. _Why:_
[0028](0028-the-docs-are-four-sections-and-guides-replace.md) said the
website replaces both files, but agents kept updating them (every
language fix since edits semantics.md, as AGENTS.md asks), while the
website's language pages drifted: rest parameters, namespace imports and
a live exported `let` were documented as refused after they compiled.
_Changed:_ 0028's replacement of docs/semantics.md and
docs/architecture.md.
