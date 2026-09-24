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
- Vale warned on the pages written before these rules until the last one
  was replaced (step 9); it now blocks on every page.

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

## 3. Start

- [x] What is Lucent (`/docs/`), Install Lucent (`/docs/install/`, Expo and
      bare as tabs that the next pages remember), Your first module
      (`/docs/first-module/`). Terminal output on them is real: `lucent
doctor` (shortened), `lucent dev --compact` and `lucent check` runs.
- [x] Replaced and redirected: getting-started, getting-started-expo.
- [x] New blocks: `panels` (alternative setups), `copy: false` (output).
- [x] Length budgets checked per kind of page (legacy pages exempt).

Found on the way, left for their own work:

- `lucent new module --ios/--android` scaffolded split platform files, not
  the standard single module; fixed on main (merged into this branch).
- `lucent explain` links to `/docs/language/diagnostics/#…`: update
  `codes.ts` when the diagnostics reference moves.
- `docs/semantics.md` lists `toSorted`, `toReversed`, `findLast*` as
  supported; they fail to type-check (the compiler loads ES2022's lib).
- An app's own `lucent.json` is not read, only Lucent packages'. The
  permissions and third-party SDK pages say so.

## 4. How Lucent works

- [x] How a module becomes native code (`/docs/how-it-works/`): the check,
      the C++ (with "See the C++"), the native package with a tour of
      `.lucent/`, the app build, Metro's proxy (generated from the compiler).
- [x] How a call reaches native code: sync and async calls, with the thread
      each step runs on.
- [x] How an SDK call reaches iOS and Android: where SDK types come from,
      what a call compiles to (both platforms' real C++), what comes back.
- [x] Diagrams, vertical so they read on phones, in both themes: the build
      (one stage highlighted per step), the call path with thread lanes, the
      platform call. The old pipeline and runtime diagrams are gone (the
      pipeline one named "lowering").
- The plan's seven steps are three pages: five build steps on one, the call
  path, the platform call.
- Pages whose "See the C++" needs an SDK the machine lacks (CI has no
  Xcode) keep their committed C++, with a warning.

## 5. Thinking in Lucent, Coming from Swift or Kotlin

- [x] Six pages: three places (diagram, copy vs reference), design the
      boundary first, shared first, threads (diagram), memory, what changes
      from JavaScript (translation table). Coming from Swift or Kotlin: the
      concept map, and an Expo module (Swift, Kotlin, JS binding, written
      for the page) next to one Lucent module.
- [x] The boundary page's numbers are a real `lucent bench` run (desktop
      Hermes). They contradict the plan's "few, coarse calls": the first run
      (2026-09-24) had one call copying 1,000 objects slower (198.7 µs) than
      1,000 calls passing numbers (111.9 µs). After main's faster struct and
      array conversion, re-measured: objects 67.1 µs, still slower than
      JavaScript (54.0 µs); two arrays of numbers 18.8 µs; data kept native
      7.9 µs. The page teaches "move the work, not the data".
- The memory page states the limit: no `Weak`, no `using`; sessions get an
  explicit `close()`.
- Found: `delete` on a `Record` compiles (a research note said otherwise);
  some messages show internal type names (`cannot convert
S:a:number to Dict<number>`).

## 6. The tutorial

- [x] `apps/tutorial/steps/<n>-<name>/`: the trip tracker at the end of each
      of the eight steps. Each compiles for iOS and Android; step 8's package
      builds in an app that depends on it.
- [x] Eight pages whose code and diffs are generated from the step folders
      (drift-checked); `samplesWith` compiles each page with its step's
      modules. Diff blocks (`diff: true`), and anchors on step headings.
- [x] The numbers on the pages (3.55 km, 1.6 m/s, 4 fixes) come from running
      the step modules as TypeScript, which the native build matches.
- Differences from the plan: step folders, not git tags. Step 5 uses the
  platform `LocationManager`, not the fused provider (Play services isn't in
  the app). Step 7 has no `lucent.json`: an app's own is not read, so the
  app adds its `Info.plist` key, and `lucent.json` arrives with the package
  in step 8.
- [ ] Device run of the tutorial on the iOS simulator and the Android
      emulator (with the other device checks, at the end).

## 7. Reference

- [x] Ten pages: language features, built-ins, types across the boundary,
      SDK types, the `lucent:*` modules, CLI, `lucent.json`, Metro/Expo/editor
      options, diagnostics, compatibility.
- [x] Generated, drift-checked: CLI (command table), diagnostics (the same
      data as `lucent explain`), `lucent:*` (the `.d.ts` files the compiler
      serves), `lucent.json` (its new schema), compatibility (doctor's
      `REQUIREMENTS` and the compiler's `MIN_ANDROID_API`). The JSON schemas
      are served at `/schemas/`, where their `$id` points.
- [x] `lucent.json` has a JSON schema (test first), kept in step with the
      fields the build reads.
- [x] `lucent explain` links to `/docs/reference/diagnostics/`; the old URL
      redirects with its anchor. The explanations were shortened to pass the
      writing rules.
- [x] Retired, with redirects: the language pages, exports, conversions,
      identity, and the old Metro, Expo and `lucent:core` pages.
- Written by hand, from verified facts (no data to generate them from):
  language features, built-ins, boundary types, SDK types.
- Found: a misplaced doc comment in `lucent:ios` (fixed); on main, three red
  diagnostics tests wait for the other session's compiler work.

## 8. Guides

- [x] 22 guides, one task each: iOS and Android APIs, finding SDK classes,
      delegates and listeners, events to JavaScript, JS callbacks, off-thread
      work, cancelling, the main thread, errors, OS versions, sharing code,
      permissions and config, third-party SDKs, publishing and using
      libraries, porting Expo and TurboModule/Nitro modules, testing,
      crashes, performance, upgrading. Every sample compiles.
- [x] `from` on a sample: a module that compiles only in its app (the
      third-party guide's, which imports the bare app's pods and AndroidX) is
      generated from its file and checked by the app's build.
- [x] Retired with redirects: errors, callbacks, boundary errors, platform
      APIs. Legacy pages left: comparison and status (step 9).
- Gaps stated as limits: no SDK pinning or `sdk diff`; no SPM; no iOS
  compile-time version check. (Jest and Vitest importing `lucent:core` was
  one; `@lucent-lang/lucent/core` closed it, and Test a module shows the
  setup.)

## 9. Examples (pulled forward, asked for on 2026-09-24)

- [x] `/docs/examples/`: a table of the ports, then one page each for
      location, netinfo, local-authentication, secure-store, haptics and
      clipboard: what to look at, the whole module, JS usage, limits. The
      source is generated from the ports' files (drift-checked), and each
      compiles as the page's sample.
- [x] README: a "Call iOS and Android" section, condensed from the location
      port and compile-checked, linking the full port and the examples.
- Found: an early return (`if (PLATFORM === "ios") return …;`) doesn't make
  the code after it Android code; a branch needs `else`. The platform-code
  guide must say so.
- [x] Roadmap (`/docs/roadmap/`), generated from `ROADMAP.md`, which was
      rewritten: it still marked delegates, iOS bindings and packages as
      later. Status redirects there.
- [x] FAQ: ten questions, each answered in at most three sentences, with a
      link.
- [x] Comparison: Lucent's rows updated (SDK access, maturity link), the
      planned-benchmark paragraph replaced by what exists (`lucent bench`),
      sources as a list, dated.
- [x] The last legacy pages are gone, and so is the `legacy` flag: Vale
      blocks on every page.

## 10. Website features

- [x] "See the C++" (`cpp: true` on a sample): the compiler's output for the
      sample, written by `scripts/website.ts` into `src/generated/cpp/<page>.ts`
      (drift-checked), loaded only when opened. Per platform for platform code.
- [x] Search: a header button, `/` and Cmd-K open a dialog over an index that
      `scripts/website.ts` builds from the pages' prose (one entry per
      section). The ranking is a tested pure function (`src/docs/search.ts`).
      Pagefind was not used: it needs pre-rendered HTML, and the site renders
      in the browser.
- [x] Code tabs, copy buttons (none on output and diffs), "Edit this page",
      "Verified with Lucent x.y", redirects that keep anchors: in place.
- [x] The homepage is a lazy route; the header fits on phones (the GitHub link
      moves to the footer there). Diagrams and pages checked in dark mode and
      at 375 px.
- [ ] Performance budget not met: a docs page loads 118 KB of JS gzipped,
      against the plan's 100 KB. React DOM and TanStack Router alone are about
      95 KB of it; the site's own code is about 20 KB. Meeting it would take
      pre-rendering or a smaller framework: a decision for the user.

## 11. README and repo docs

- [x] README: one page (pitch, a shared module, one SDK function, install,
      links, develop).
- [x] CONTRIBUTING.md: setup with Hermes, the suites, the commit style, how
      the docs are checked.
- [x] `docs/design/` holds the M2 proposal, marked as since implemented;
      `platform-bindings.md` and `semantics.md` corrected (ES2023 methods,
      LUCENT3007); `lucent-packages.md` points users to the site.

## Left

- [ ] Device run of the tutorial on the iOS simulator and the Android
      emulator.
- [ ] The acceptance test with two people from outside the project, on a
      fresh Expo app and a fresh bare app (the user's to run).
- [ ] Runnable samples in CI (run in Hermes, output compared with the page):
      not built. The tutorial's numbers were checked by running its modules
      as TypeScript instead.
- [ ] External link check, weekly: not set up.
