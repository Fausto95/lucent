# Tutorial: a trip tracker

The project the website's tutorial builds, one folder per step
(`steps/<n>-<name>/`). Each folder is the whole project at the end of
that step: its `*.lucent.ts` modules, the `App.tsx` that calls them,
and the config the step adds.

The tutorial pages take their code from these files, and their diffs
from one step to the next: `pnpm exec tsx scripts/website.ts` generates
both (`apps/website/src/generated/tutorial/`) and compiles each step's
modules. Change a step here, not on the page, and later steps with it.
