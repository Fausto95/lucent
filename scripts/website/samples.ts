import { formatDiagnostic } from "../../packages/compiler/src/index.ts";
import type { Block, CppFile, DocPage } from "../../apps/website/src/docs/types.ts";
import { compileSamples, type Sample } from "./compile.ts";
import { where } from "./context.ts";

function samplesOf(blocks: Block[]): Sample[] {
  return blocks.flatMap((b): Sample[] => {
    if (b.kind === "code") return b.filename.endsWith(".lucent.ts") ? [b] : [];
    if (b.kind === "tabs") return b.tabs.filter((t) => t.filename.endsWith(".lucent.ts"));
    if (b.kind === "steps") return b.steps.flatMap((s) => samplesOf(s.blocks));
    if (b.kind === "panels") return b.panels.flatMap((p) => samplesOf(p.blocks));
    return [];
  });
}

/** The files the compiler wrote for one module: one, or one per platform when it has platform code. */
function cppOf(files: Map<string, string>, filename: string): CppFile[] {
  const module = `m_${filename.replace(/\.lucent\.ts$/, "")}`;
  const candidates: [string, string][] = [
    ["C++", `${module}.cpp`],
    ["iOS", `ios/${module}.mm`],
    ["iOS", `ios/${module}.cpp`],
    ["Android", `android/${module}.cpp`],
  ];
  return candidates.flatMap(([label, name]) => {
    const code = files.get(name);
    return code === undefined ? [] : [{ label, filename: name.split("/").pop()!, code: code.trimEnd() }];
  });
}

/**
 * A page's samples compile together, as one app; a sample with `expect` compiles alone and must fail with that code.
 * Returns the C++ of the samples marked `cpp`, by page slug.
 */
export function checkSamples(pages: DocPage[]): { checked: number; problems: string[]; cpp: Map<string, Record<string, CppFile[]>> } {
  const problems: string[] = [];
  const cpp = new Map<string, Record<string, CppFile[]>>();
  let checked = 0;
  for (const page of pages) {
    const samples = samplesOf(page.blocks);
    const app = samples.filter((s) => !s.expect);
    const names = app.map((s) => s.filename);
    for (const dup of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
      problems.push(`${where(page.slug)}: two samples are named ${dup}; a page's samples form one app`);
    }
    if (app.length) {
      const { diagnostics, files } = compileSamples(page.slug || "index", app);
      for (const d of diagnostics) problems.push(`${where(page.slug)}: ${formatDiagnostic(d)}`);
      const shown = app.filter((s) => s.cpp);
      if (shown.length && !diagnostics.length) cpp.set(page.slug, Object.fromEntries(shown.map((s) => [s.filename, cppOf(files, s.filename)])));
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
  return { checked, problems, cpp };
}
