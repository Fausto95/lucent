# 0048. The plan is split into files

- **Date:** 2026-10-08
- **Status:** accepted

ROADMAP.md keeps the principles, the status at a glance, the gates and
what's next, in under 200 lines. Each decision of its log is a file in
`docs/decisions/` (this one is the 48th), numbered by date, with its
text unchanged. The tasks, their checklists, the requirements, the
performance budgets, the validation profiles, the contracts and the
design slices are in `docs/tasks.md`; the known limitations and
deferred checks in `docs/limitations.md`; the architecture summary in
`docs/design/overview.md`. The Done list goes: it repeated the
changelog. Tasks stay in the repository, not in GitHub issues, so a
commit updates the task it works on, and each status names the PR
that merged it and the release that shipped it. The second task
numbered TA35 (the reference ports, #128) becomes TA36, so each task id
names one task. _Why:_ ROADMAP.md had grown to 2,917 lines; agents and
reviewers edited one file for every change, its statuses drifted from
what had merged (T28, T48 to T50, T54, T61 and TA30 to TA34 said "in
review" after they shipped in 0.1.3 and 0.2.0), and two tasks shared
one anchor. _Changed:_ [0014](0014-publish-the-plan.md)'s "this file
as the single source of truth" now means these files together;
AGENTS.md and CONTRIBUTING.md say where to record a task, a decision
and a limitation.
