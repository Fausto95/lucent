# 0028. The docs are four sections, and guides replace the tutorial

- **Date:** 2026-10-04
- **Status:** accepted; amended by [0049](0049-old-docs-urls-redirect.md) and [0050](0050-docs-and-specs-have-one-owner-each.md)

The website's docs split into Guides, Packages, API and
Architecture, each a header tab with its own sidebar. The trip-tracker
tutorial and the guides merge into one set of guides, rewritten against
the code: an ordered "Get started", then one task per page. The language
spec moves from docs/semantics.md onto the API section; Architecture ends
with an Internals group for contributors that replaces
docs/architecture.md. Removed pages get no redirect, and the redirect
setup goes. _Why:_ the docs mixed tutorial, guide, explanation and
reference in each group and repeated facts that had drifted from the code;
until production grade the docs evolve with it, so old URLs aren't kept.
_Changed:_ the 2026-09-24 Docs decision (the trip-tracker tutorial) and
T66's tutorial items.
