# 0029. The website runs on Docusaurus

- **Date:** 2026-10-04
- **Status:** accepted

The site moves from Astro
Starlight to Docusaurus, as reactnative.dev runs, and its docs take
React Native's layout: one navbar item and sidebar per section, collapsed
groups with sub-groups, and a Releases section with the roadmap and the
changelog. The homepage is ported as it was, the search is a local index,
and code blocks keep their look through Expressive Code. _Why:_ the
sections, sidebars and pagination React Native's docs have are built into
Docusaurus, where Starlight needed a route middleware, overrides and a
theme patch. _Changed:_ the 2026-10-01 move to Starlight and the 2026-10-03
homepage decision (the page is the same, in React).
