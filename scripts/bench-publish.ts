/**
 * Publishes a run of scripts/bench.ts on the website's comparison page:
 * copies its results (`--json`) to benchmarks/results/<name>.json, where
 * scripts/website.ts reads them into the page's dated tables.
 *
 *   HERMES_DIR=~/hermes node scripts/bench.ts --json /tmp/bench.json
 *   node scripts/bench-publish.ts /tmp/bench.json [name]   (name: <platform>-<arch>)
 *   node scripts/website.ts
 *
 * A result with more than 100 samples (the single-call latencies, 2,000
 * each) keeps its summary and drops the samples, so the file stays small
 * enough to review; the note says how many there were.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readResults, writeResults } from "../packages/lucent/src/cli/bench-results.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [input, name] = process.argv.slice(2);
if (!input) throw new Error("usage: node scripts/bench-publish.ts <results.json> [name]");

const { manifest, results } = readResults(input);
if (manifest.git?.dirty)
  console.warn("! the run was made from a dirty tree: its commit is not the code measured");
const out = path.join(
  root,
  "benchmarks/results",
  `${name ?? `${manifest.host.platform}-${manifest.host.arch}`}.json`,
);
writeResults(out, {
  manifest,
  results: results.map((r) =>
    r.samples.length > 100
      ? {
          ...r,
          samples: [],
          note: [r.note, `${r.samples.length} samples, summarized`].filter(Boolean).join("; "),
        }
      : r,
  ),
});
console.log(`${path.relative(root, out)}: ${results.length} results from ${manifest.createdAt}`);
