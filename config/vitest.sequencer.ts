/**
 * Shards the test files by how long they take, so that each shard takes
 * about as long: vitest's own sharding splits them by their paths' hashes,
 * which left one CI shard nearly twice as long as another. The longest
 * files go first, each to the shard with the least time so far; a file
 * test-timings.json does not list (a new one) counts as the median.
 * `node scripts/test-timings.ts <vitest JSON report>` writes the timings.
 */
import fs from "node:fs";
import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

const timings: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "test-timings.json"), "utf8"),
);

export default class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const known = Object.values(timings).sort((a, b) => a - b);
    const median = known[Math.floor(known.length / 2)] ?? 1;
    const weighed = files
      .map((spec) => {
        const file = path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join("/");
        return { spec, file, seconds: timings[file] ?? median };
      })
      // Longest first; equal ones by path, so that every shard computes the same split.
      .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
    const shards = Array.from({ length: count }, () => ({
      seconds: 0,
      specs: [] as TestSpecification[],
    }));

    for (const w of weighed) {
      const least = shards.reduce((a, b) => (b.seconds < a.seconds ? b : a));
      least.seconds += w.seconds;
      least.specs.push(w.spec);
    }

    return shards[index - 1]!.specs;
  }
}
