/**
 * Writes test-timings.json, how long each test file took, for the shards
 * vitest.sequencer.ts makes: from a vitest JSON report of a full run.
 *
 *   LUCENT_ALL_TESTS=1 pnpm exec vp test run --reporter=json --outputFile=report.json
 *   node scripts/test-timings.ts report.json
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const report = process.argv[2];
if (!report) throw new Error("usage: node scripts/test-timings.ts <vitest JSON report>");

const { testResults } = JSON.parse(fs.readFileSync(report, "utf8")) as {
  testResults: { name: string; startTime: number; endTime: number }[];
};
const timings = Object.fromEntries(
  testResults
    .map((f) => [
      path.relative(root, f.name).split(path.sep).join("/"),
      Math.max(0.1, Math.round((f.endTime - f.startTime) / 100) / 10),
    ])
    .sort(([a], [b]) => String(a).localeCompare(String(b))),
);

fs.writeFileSync(path.join(root, "test-timings.json"), `${JSON.stringify(timings, null, 2)}\n`);
console.log(`test-timings.json: ${Object.keys(timings).length} files`);
