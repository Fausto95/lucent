# 0020. Separate the marketing homepage from the docs shell

- **Date:** 2026-10-03
- **Status:** accepted

The reviewed Voltage design is a dedicated Astro page; Starlight continues
to provide docs, search and the mobile drawer. _Why:_ the homepage needs
its own layout while docs retain their navigation and reading tools.
Sidebar titles wrap in full rather than relying on truncated hover text.
