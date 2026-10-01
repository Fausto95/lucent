import { formatDiagnostic } from "../../packages/compiler/src/index.ts";
import { PLATFORMS, platformSdkTyped } from "../../packages/compiler/src/sdk/schema.ts";
import type { Block, CppFile } from "../../apps/website/src/docs/types.ts";
import fs from "node:fs";
import path from "node:path";
import { compileSamples, type Sample } from "./compile.ts";
import { root } from "./context.ts";
import type { CheckedPage } from "./pages.ts";

const isSample = (b: { filename: string; diff?: true; from?: string }): boolean =>
  /\.lucent\.tsx?$/.test(b.filename) && !b.diff && !b.from;

function samplesOf(blocks: Block[]): Sample[] {
  return blocks.flatMap((b): Sample[] => {
    if (b.kind === "code") return isSample(b) ? [b] : [];
    if (b.kind === "tabs") return b.tabs.filter(isSample);
    if (b.kind === "steps") return b.steps.flatMap((s) => samplesOf(s.blocks));
    if (b.kind === "panels") return b.panels.flatMap((p) => samplesOf(p.blocks));
    return [];
  });
}

/** The `*.lucent.ts` files under `dir` that the page doesn't show itself, by file name. */
function contextOf(dir: string, shown: Sample[]): Sample[] {
  const names = new Set(shown.map((s) => s.filename));
  const full = path.join(root, dir);
  return fs
    .readdirSync(full, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".lucent.ts") && !names.has(path.basename(f)))
    .map((f) => ({
      filename: path.basename(f),
      code: fs.readFileSync(path.join(full, f), "utf8"),
    }));
}

/** The files the compiler wrote for one module: one, or one per platform when it has platform code. */
function cppOf(files: Map<string, string>, filename: string): CppFile[] {
  const module = `m_${filename.replace(/\.lucent\.tsx?$/, "")}`;
  const candidates: [string, string][] = [
    ["C++", `${module}.cpp`],
    ["iOS", `ios/${module}.mm`],
    ["iOS", `ios/${module}.cpp`],
    ["Android", `android/${module}.cpp`],
  ];
  return candidates.flatMap(([label, name]) => {
    const code = files.get(name);
    return code === undefined
      ? []
      : [{ label, filename: name.split("/").pop()!, code: code.trimEnd() }];
  });
}

/**
 * A page's samples compile together, as one app; a sample with `expect` compiles alone and must fail with that code.
 * Returns the C++ of the samples marked `cpp`, by page URL.
 */
export function checkSamples(pages: CheckedPage[]): {
  checked: number;
  problems: string[];
  cpp: Map<string, Record<string, CppFile[]>>;
  /** Pages whose platform C++ needs an SDK this machine lacks (CI has no Xcode), by URL: their generated C++ is left as it is. */
  unbuilt: Map<string, string[]>;
  /** Pages of view components that no SDK here compiles (a component's view is a platform's), by URL. */
  unchecked: string[];
} {
  const problems: string[] = [];
  const cpp = new Map<string, Record<string, CppFile[]>>();
  const unbuilt = new Map<string, string[]>();
  const missing = PLATFORMS.filter((p) => !platformSdkTyped(p));
  const unchecked: string[] = [];
  let checked = 0;
  for (const page of pages) {
    const samples = samplesOf(page.blocks);
    // A view component compiles for a platform whose SDK is here; one is enough.
    if (page.views && samples.length && missing.length === PLATFORMS.length) {
      unchecked.push(page.href);
      continue;
    }
    const own = samples.filter((s) => !s.expect);
    const app = [...own, ...(page.samplesWith ? contextOf(page.samplesWith, own) : [])];
    const names = app.map((s) => s.filename);
    for (const dup of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
      problems.push(`${page.href}: two samples are named ${dup}; a page's samples form one app`);
    }
    // Each page compiles in its own directory, named after its URL.
    const dir = page.href.slice(1, -1);
    if (app.length) {
      const { diagnostics, files } = compileSamples(dir, app, { views: page.views === true });
      for (const d of diagnostics) problems.push(`${page.href}: ${formatDiagnostic(d)}`);
      const shown = app.filter((s) => s.cpp);
      const platformCode = shown.some((s) => /from "lucent:(ios|android)/.test(s.code));
      // "See the C++" reads a docs page's generated C++ (src/generated/cpp/<slug>.json).
      if (shown.length && page.kind === "post")
        problems.push(`${page.href}: "See the C++" (cpp: true) is for docs pages`);
      else if (shown.length && platformCode && missing.length) unbuilt.set(page.href, missing);
      else if (shown.length && !diagnostics.length)
        cpp.set(
          page.href,
          Object.fromEntries(shown.map((s) => [s.filename, cppOf(files, s.filename)])),
        );
    }
    for (const s of samples.filter((x) => x.expect)) {
      const { diagnostics } = compileSamples(`${dir}-expect`, [s], {
        views: page.views === true,
      });
      if (!diagnostics.some((d) => d.code === s.expect)) {
        const got = diagnostics.length
          ? diagnostics.map(formatDiagnostic).join("; ")
          : "it compiled";
        problems.push(`${page.href}: ${s.filename} should fail with ${s.expect}, but ${got}`);
      }
    }
    checked += samples.length;
  }
  return { checked, problems, cpp, unbuilt, unchecked };
}
