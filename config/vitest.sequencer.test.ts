import { describe, expect, it } from "vite-plus/test";
import { split, timingsFor } from "./vitest.sequencer.ts";

describe("the timed sequencer", () => {
  it("reads the timings measured on the platform it runs on", () => {
    const timings = { linux: { "a.test.ts": 1 }, darwin: { "a.test.ts": 9 } };
    expect(timingsFor(timings, "linux")).toEqual({ "a.test.ts": 1 });
    expect(timingsFor(timings, "darwin")).toEqual({ "a.test.ts": 9 });
  });

  it("falls back to another platform's timings for a platform without its own", () => {
    expect(timingsFor({ linux: { "a.test.ts": 1 } }, "win32")).toEqual({ "a.test.ts": 1 });
  });

  it("gives each shard about the same time, the longest files first", () => {
    const timings = { "a.ts": 10, "b.ts": 6, "c.ts": 5, "d.ts": 1 };
    const shards = split(["a.ts", "b.ts", "c.ts", "d.ts"], timings, 2);
    expect(shards).toEqual([
      ["a.ts", "d.ts"],
      ["b.ts", "c.ts"],
    ]);
  });

  it("counts a file without a timing as the median", () => {
    const shards = split(
      ["a.ts", "b.ts", "c.ts", "new.ts"],
      { "a.ts": 4, "b.ts": 3, "c.ts": 1 },
      2,
    );
    expect(shards).toEqual([
      ["a.ts", "c.ts"],
      ["b.ts", "new.ts"],
    ]);
  });
});
