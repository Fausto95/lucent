import type { Block, DocFrontmatter } from "../../types";
import { limitations, milestones } from "../../../generated/roadmap";

export const frontmatter: DocFrontmatter = {
  title: "Roadmap",
  description: "What works today, what's next, and what's later, milestone by milestone.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "note",
    tone: "warn",
    text: "Lucent is experimental. Its APIs change without a migration path, and it hasn't been tested on physical devices. Don't ship it in a production app yet.",
  },
  ...milestones.flatMap(({ title, goal, items }): Block[] => [
    { kind: "h2", text: title },
    ...(goal ? [{ kind: "p" as const, text: goal }] : []),
    items.every((item) => item.status)
      ? {
          kind: "table" as const,
          head: ["Status", "Item"],
          rows: items.map((item) => [item.status!, item.text]),
        }
      : { kind: "list" as const, items: items.map((item) => item.text) },
  ]),
  { kind: "h2", text: "Known limitations" },
  ...limitations.flatMap(({ title, items }): Block[] => [
    { kind: "h3", text: title },
    { kind: "list", items },
  ]),
  {
    kind: "p",
    text: "This page is generated from [ROADMAP.md](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md) and [docs/limitations.md](https://github.com/Fausto95/lucent/blob/main/docs/limitations.md) in the repository. Each task is in [docs/tasks.md](https://github.com/Fausto95/lucent/blob/main/docs/tasks.md).",
  },
];
