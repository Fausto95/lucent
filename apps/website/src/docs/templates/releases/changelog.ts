import type { Block, DocFrontmatter } from "../../types";
import { releases } from "../../../generated/changelog";

export const frontmatter: DocFrontmatter = {
  title: "Changelog",
  description: "What changed in each release of `@lucent-lang/lucent`, newest first.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Each entry links the pull request that made it. Before 1.0, a minor release may break what an earlier one did: read its entries before upgrading ([Upgrade Lucent](/docs/guides/upgrade-lucent/)).",
  },
  ...releases.flatMap(({ version, changes }): Block[] => [
    { kind: "h2", text: version },
    ...changes.flatMap(({ kind, entries }): Block[] => [
      { kind: "h3", text: kind },
      { kind: "list", items: entries },
    ]),
  ]),
  {
    kind: "p",
    text: "This page is generated from [CHANGELOG.md](https://github.com/Fausto95/lucent/blob/main/packages/lucent/CHANGELOG.md), which each release writes from its changesets.",
  },
];
