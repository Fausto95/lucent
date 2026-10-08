/**
 * Shards the test files by how long they take, so that each shard takes
 * about as long: vitest's own sharding splits them by their paths' hashes,
 * which left one CI shard nearly twice as long as another. The longest
 * files go first, each to the shard with the least time so far; a file
 * test-timings.json does not list (a new one) counts as the median.
 *
 * The times are per platform (`linux`, `darwin`): the same file can take
 * six times as long on one runner as on the other, and skip most of its
 * tests on one of them. `node scripts/test-timings.ts <vitest JSON report>`
 * writes the running platform's.
 */
import fs from "node:fs";
import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

export type Timings = Record<string, number>;

/** The timings measured on `platform`, else another platform's. */
export function timingsFor(all: Record<string, Timings>, platform: string): Timings {
  return all[platform] ?? Object.values(all)[0] ?? {};
}

/** `files` in `count` shards of about equal time; every caller computes the same split. */
export function split(files: string[], timings: Timings, count: number): string[][] {
  const known = Object.values(timings).sort((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)] ?? 1;
  const weighed = files
    .map((file) => ({ file, seconds: timings[file] ?? median }))
    // Longest first; equal ones by path, so that every shard computes the same split.
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const shards = Array.from({ length: count }, () => ({ seconds: 0, files: [] as string[] }));
  for (const w of weighed) {
    const least = shards.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    least.seconds += w.seconds;
    least.files.push(w.file);
  }
  return shards.map((s) => s.files);
}

export default class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const all: Record<string, Timings> = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "test-timings.json"), "utf8"),
    );
    const byFile = new Map(
      files.map((spec) => [
        path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join("/"),
        spec,
      ]),
    );
    const mine = split([...byFile.keys()], timingsFor(all, process.platform), count)[index - 1]!;
    return mine.map((file) => byFile.get(file)!);
  }
}
