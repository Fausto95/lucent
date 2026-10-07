# 0049. Old docs URLs redirect

- **Date:** 2026-10-08
- **Status:** accepted

Every docs URL the site has served redirects permanently to the page
that replaced it: `apps/website/src/docs/redirects.ts` lists them, from
the Starlight site's pages and the redirects it already had, and
`scripts/website.ts` writes them into `vercel.json` and fails when one
points at a page that isn't in the sidebar, or when a URL a published
CLI prints is neither a page nor redirected. A page that moves or goes
adds its old slug there. _Why:_ the published CLIs (0.0.4 to 0.2.0)
print `/docs/install/` and `/docs/reference/diagnostics/#…`, and npm's
READMEs link to the old pages: dropping them broke every one of those
links. _Changed:_ [0028](0028-the-docs-are-four-sections-and-guides-replace.md)'s
"removed pages get no redirect".
