/**
 * The failed tests of a unit-test run, as GitHub annotations: one listing
 * every failed test, then one per failed file with its first failure's
 * message. A failing step's own annotation (ci-trap.sh) keeps only the end
 * of its output, which names the last few failures alone.
 *
 *   node scripts/test-failures.ts unit-test-report.json
 *
 * It reads Vitest's JSON report, prints nothing when every test passed, and
 * exits 0 either way: the test step already failed the job.
 */
import fs from "node:fs";
import path from "node:path";

interface Assertion {
  fullName: string;
  status: string;
  failureMessages?: string[];
}

interface FileResult {
  name: string;
  status: string;
  message?: string;
  assertionResults: Assertion[];
}

export interface Failure {
  file: string;
  test?: string;
  message: string;
}

/** The failures of a report: each failed test, and each file that failed without one (an import error). */
export function failures(report: { testResults: FileResult[] }, root: string): Failure[] {
  const out: Failure[] = [];
  for (const r of report.testResults) {
    const file = path.relative(root, r.name);
    const failed = r.assertionResults.filter((a) => a.status === "failed");
    for (const a of failed)
      out.push({ file, test: a.fullName, message: (a.failureMessages ?? []).join("\n") });
    if (!failed.length && r.status === "failed") out.push({ file, message: r.message ?? "" });
  }
  return out;
}

/** An annotation's message, as a workflow command escapes it, within GitHub's 4,096 characters. */
const escaped = (text: string, max = 3800) =>
  (text.length > max ? `${text.slice(0, max)}…` : text)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");

/** A command's property (file, title), which escapes `:` and `,` too. */
const property = (text: string, max = 200) =>
  escaped(text, max).replace(/:/g, "%3A").replace(/,/g, "%2C");

// Colors and the terminal's own escapes out of a message.
// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** The workflow commands for `list`: a summary, then one per file (GitHub shows ten errors a step). */
export function annotations(list: Failure[]): string[] {
  if (!list.length) return [];
  const names = list.map((f) => (f.test ? `${f.file} > ${f.test}` : `${f.file} (did not run)`));
  const lines = [`::error title=${list.length} tests failed::${escaped(names.join("\n"))}`];

  const byFile = new Map<string, Failure>();
  for (const f of list) if (!byFile.has(f.file)) byFile.set(f.file, f);
  for (const f of [...byFile.values()].slice(0, 9))
    lines.push(
      `::error file=${property(f.file)},title=${property(f.test ?? "did not run")}::${escaped(plain(f.message), 1500)}`,
    );
  return lines;
}

if (import.meta.main) {
  const file = process.argv[2] ?? "unit-test-report.json";
  if (!fs.existsSync(file)) {
    console.log(`no ${file}: the tests did not get to report`);
  } else {
    const report = JSON.parse(fs.readFileSync(file, "utf8")) as { testResults: FileResult[] };
    for (const line of annotations(failures(report, process.cwd()))) console.log(line);
  }
}
