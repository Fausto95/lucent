import { formatDiagnostic } from "../../packages/compiler/src/index.ts";
import type { Block, DocPage } from "../../apps/website/src/docs/types.ts";
import { compileSamples, type Sample } from "./compile.ts";
import { where } from "./context.ts";

function samplesOf(blocks: Block[]): Sample[] {
  return blocks.flatMap((b): Sample[] => {
    if (b.kind === "code") return b.filename.endsWith(".lucent.ts") ? [b] : [];
    if (b.kind === "tabs") return b.tabs.filter((t) => t.filename.endsWith(".lucent.ts"));
    if (b.kind === "steps") return b.steps.flatMap((s) => samplesOf(s.blocks));
    return [];
  });
}

/** A page's samples compile together, as one app; a sample with `expect` compiles alone and must fail with that code. */
export function checkSamples(pages: DocPage[]): { checked: number; problems: string[] } {
  const problems: string[] = [];
  let checked = 0;
  for (const page of pages) {
    const samples = samplesOf(page.blocks);
    const app = samples.filter((s) => !s.expect);
    const names = app.map((s) => s.filename);
    for (const dup of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
      problems.push(`${where(page.slug)}: two samples are named ${dup}; a page's samples form one app`);
    }
    if (app.length) {
      const { diagnostics } = compileSamples(page.slug || "index", app);
      for (const d of diagnostics) problems.push(`${where(page.slug)}: ${formatDiagnostic(d)}`);
    }
    for (const s of samples.filter((x) => x.expect)) {
      const { diagnostics } = compileSamples(`${page.slug}-expect`, [s]);
      if (!diagnostics.some((d) => d.code === s.expect)) {
        const got = diagnostics.length ? diagnostics.map(formatDiagnostic).join("; ") : "it compiled";
        problems.push(`${where(page.slug)}: ${s.filename} should fail with ${s.expect}, but ${got}`);
      }
    }
    checked += samples.length;
  }
  return { checked, problems };
}
