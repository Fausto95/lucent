/**
 * Writes this platform's entry of config/test-timings.json, how long each
 * test file took, for the shards config/vitest.sequencer.ts makes: from a
 * vitest JSON report of a full run. The other platforms' entries stay.
 *
 *   LUCENT_ALL_TESTS=1 pnpm exec vp test run --reporter=json --outputFile=report.json
 *   node scripts/test-timings.ts report.json [linux|darwin]
 *
 * CI keeps each shard's report as an artifact (unit-test-report-*): merge
 * a run's shards with `node scripts/test-timings.ts a.json b.json … --platform darwin`.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "config/test-timings.json");
const args = process.argv.slice(2);
const at = args.indexOf("--platform");
const platform = at >= 0 ? args.splice(at, 2)[1]! : process.platform;
const reports = args;
if (reports.length === 0)
  throw new Error("usage: node scripts/test-timings.ts <vitest JSON report>… [--platform <name>]");

const timings: Record<string, number> = {};
for (const report of reports) {
  const { testResults } = JSON.parse(fs.readFileSync(report, "utf8")) as {
    testResults: { name: string; startTime: number; endTime: number }[];
  };
  for (const f of testResults)
    timings[path.relative(root, f.name).split(path.sep).join("/")] = Math.max(
      0.1,
      Math.round((f.endTime - f.startTime) / 100) / 10,
    );
}

const all: Record<string, Record<string, number>> = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
all[platform] = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)));
const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`config/test-timings.json: ${Object.keys(timings).length} files for ${platform}`);
