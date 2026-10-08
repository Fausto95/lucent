/**
 * Swift AsyncSequences (StoreKit's Transaction.updates, AsyncStream):
 * collected with a Lucent function, as a Kotlin Flow is, until the
 * sequence ends, throws or the AbortSignal aborts. Typed from a schema
 * set, so the generated glue and Swift are checked on any machine.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "Store",
      frameworks: [],
      types: [
        {
          kind: "class",
          name: "Transaction",
          native: "Store.Transaction",
          swift: { kind: "struct" },
          properties: [
            { name: "id", type: "uint64", readonly: true, swift: { name: "id" } },
            {
              name: "updates",
              type: "AsyncSequence<Store.Transaction>",
              static: true,
              readonly: true,
              swift: { name: "updates" },
            },
          ],
          methods: [
            {
              name: "counts",
              params: [{ name: "upTo", type: "NSInteger" }],
              returns: "AsyncSequence<NSInteger>",
              static: true,
              swift: { name: "counts(upTo:)" },
            },
          ],
        },
      ],
    },
  ]);

const program = (body: string) =>
  setProgram(
    `import { Transaction } from "lucent:ios/Store";
export async function run(): Promise<string> {
${body}
}
`,
    set(),
  );

describe("Swift async sequences", () => {
  it("are declared as lucent:ios's AsyncSequence, collected with a function and a signal", () => {
    const p = program("  return \"\";");
    const dts = p.types.get("ios/Store.d.ts") ?? "";

    expect(p.messages).toEqual([]);
    expect(dts).toMatch(/static readonly updates: AsyncSequence<Transaction>;/);
    expect(dts).toMatch(/static counts\(upTo: bigint\): AsyncSequence<bigint>;/);
  });

  it("iterate in a Swift task, each element delivered to the Lucent function", () => {
    const p = program(`  const ids: bigint[] = [];
  const controller = new AbortController();
  await Transaction.updates.collect((t) => {
    ids.push(t.id);
    if (ids.length === 2) controller.abort();
  }, controller.signal);
  let total = 0n;
  await Transaction.counts(3n).collect((n) => {
    total += n;
  });
  return \`\${ids.join(",")} \${total}\`;`);

    expect(p.messages).toEqual([]);
    // The shim gives the sequence boxed; collecting it is a task iterating it.
    expect(p.shims).toContain("LucentSequence(Store.Transaction.updates)");
    expect(p.shims).toMatch(/for try await e in s_/);
    expect(p.shims).toContain("@_cdecl(\"lucent_swift_collect\")");
    // The glue delivers each element on the Lucent thread, as a native operation that settles at the end.
    expect(p.mm).toContain("lucent::nativeOperation");
    expect(p.mm).toContain("lucent_swift_collect");
    expect(p.mm).toContain("lucent::postCallback");
  });

  it("refuse collecting with an async function: the sequence would not wait for it", () => {
    const p = program(`  await Transaction.updates.collect(async (t) => {
    await Promise.resolve(t.id);
  });
  return "";`);

    expect(p.messages).toEqual([
      [
        "LUCENT2002",
        expect.stringMatching(/collect takes a function that is not async/),
      ],
    ]);
  });
});
