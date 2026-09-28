import { describe, expect, it } from "vite-plus/test";
import {
  classThreadFlags,
  memberFacts,
  memberThreadFlags,
  threadFacts,
  type ThreadMark,
  UNKNOWN_FACTS,
} from "../src/facts.ts";

const mark = (affinity: ThreadMark["affinity"]): ThreadMark => ({
  affinity,
  source: "annotation",
  detail: `@${affinity}`,
});
const facts = (affinity?: ThreadMark["affinity"]) =>
  affinity ? threadFacts(mark(affinity)) : undefined;

describe("native facts", () => {
  it("proves affinity from a thread annotation, and nothing about blocking or ownership", () => {
    expect(
      threadFacts({ affinity: "worker", source: "annotation", detail: "@WorkerThread" }),
    ).toEqual({
      affinity: "worker",
      blocking: "unknown",
      ownership: "unknown",
      evidence: [{ fact: "affinity", source: "annotation", detail: "@WorkerThread" }],
    });
    expect(UNKNOWN_FACTS).toEqual({
      affinity: "unknown",
      blocking: "unknown",
      ownership: "unknown",
      evidence: [],
    });
  });

  it("gives a member its own facts, else its class's, else none known", () => {
    const main = facts("main");
    const any = facts("any");

    expect(memberFacts({ facts: main }, { facts: any })).toBe(any);
    expect(memberFacts({ facts: main }, {})).toBe(main);
    expect(memberFacts({}, {})).toEqual(UNKNOWN_FACTS);
    expect(memberFacts(undefined, {})).toEqual(UNKNOWN_FACTS);
  });

  it("derives the older thread flags from the same facts", () => {
    const affinities = [undefined, "main", "worker", "any"] as const;
    const table = affinities.map((cls) => [
      cls ?? "-",
      ...affinities.map((own) => {
        const flags = memberThreadFlags(facts(cls), facts(own));
        return [
          flags.mainActor === undefined ? "" : `mainActor:${flags.mainActor}`,
          flags.worker ? "worker" : "",
        ]
          .filter(Boolean)
          .join(" ");
      }),
    ]);

    // Rows: the class's affinity; columns: the member's own (none, main, worker, any).
    // A class's own flag covers its members, so they repeat only what differs.
    // A @WorkerThread member of a main-only class overrides the class: it is
    // not main-only (mainActor false) and is a worker member.
    expect(table).toEqual([
      ["-", "", "mainActor:true", "worker", ""],
      ["main", "", "", "mainActor:false worker", "mainActor:false"],
      ["worker", "worker", "mainActor:true", "worker", ""],
      ["any", "", "mainActor:true", "worker", ""],
    ]);
    expect(affinities.map((a) => classThreadFlags(facts(a)))).toEqual([
      {},
      { mainActor: true },
      {},
      {},
    ]);
  });
});
