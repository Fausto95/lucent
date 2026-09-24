import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Block, DocPage } from "../../apps/website/src/docs/types.ts";
import { root, where } from "./context.ts";

/** Everything a reader reads, as Markdown. Code is left out: Vale checks the words around it. */
export function proseOf(blocks: Block[]): string[] {
  return blocks.flatMap((b): string[] => {
    switch (b.kind) {
      case "p":
        return [b.text];
      case "h2":
        return [`## ${b.text}`];
      case "h3":
        return [`### ${b.text}`];
      case "note":
        return [`> ${b.text}`];
      case "list":
        return [b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n")];
      case "table":
        return [
          [b.head, b.head.map(() => "---"), ...b.rows]
            .map((row) => `| ${row.join(" | ")} |`)
            .join("\n"),
        ];
      case "diagram":
        return b.caption ? [b.caption] : [];
      case "steps":
        return b.steps.flatMap((step) => [`### ${step.title}`, ...proseOf(step.blocks)]);
      case "panels":
        return b.panels.flatMap((panel) => [`### ${panel.label}`, ...proseOf(panel.blocks)]);
      case "cards":
        return b.items.map((item) => `**${item.title}**: ${item.text}`);
      case "code":
      case "tabs":
      case "comparison":
        return [];
    }
  });
}

const proseDir = path.join(root, "apps/website/.prose");

/** Writes each page's prose to apps/website/.prose/ and runs Vale on it. */
export function checkProse(
  pages: DocPage[],
  required: boolean,
): { ran: boolean; problems: string[]; warnings: string[] } {
  fs.rmSync(proseDir, { recursive: true, force: true });
  const byFile = new Map<string, DocPage>();
  for (const page of pages) {
    const file = path.join(proseDir, `${page.slug || "index"}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [`# ${page.title}`, page.description, ...proseOf(page.blocks)].join("\n\n") + "\n",
    );
    byFile.set(file, page);
  }
  const vale = spawnSync(
    "vale",
    ["--config", path.join(root, "apps/website/.vale.ini"), "--output=line", proseDir],
    { encoding: "utf8" },
  );
  if (vale.error) {
    const missing = "Vale is not installed (brew install vale)";
    return required
      ? { ran: false, problems: [missing], warnings: [] }
      : { ran: false, problems: [], warnings: [`prose not checked: ${missing}`] };
  }
  const problems: string[] = vale.stderr.trim() ? [vale.stderr.trim()] : [];
  const warnings: string[] = [];
  // Lines read `file:line:column:rule:message`.
  for (const line of vale.stdout.trim().split("\n").filter(Boolean)) {
    const [file = "", at, , rule, ...message] = line.split(":");
    const page = byFile.get(file);
    const finding = `${page ? where(page.slug) : file}: ${message.join(":")} [${rule}, .prose/${path.relative(proseDir, file)}:${at}]`;
    problems.push(finding);
  }
  return { ran: true, problems, warnings };
}
