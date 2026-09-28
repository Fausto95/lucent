import { beforeAll, describe, expect, it } from "vite-plus/test";
import { extractIos } from "@lucent-lang/bindgen";
import { swiftModule } from "../../bindgen/test/swift-module.ts";
import { sdkDts } from "../src/sdk/dts.ts";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  xcode,
} from "./swift-harness.ts";

/** A program's iOS output, compiled against the Orbit fixture module. */
const orbit = (src: string) => iosProgram(src, ["Orbit"]);

/** Property, throwing, async and mutating requirements, as Swift uses them. */
const effects = `import { Sources, type Source } from "lucent:ios/Orbit";

class Shelf implements Source {
  readonly name = "shelf";
  limit = 2;
  resets = 0;

  titles(): string[] {
    if (this.limit < 0) throw new Error("negative limit");

    return ["a", "b"];
  }

  async fetch(prefix: string): Promise<string[]> {
    if (prefix === "!") throw new Error(\`bad prefix \${prefix}\`);

    return [\`\${prefix}1\`, \`\${prefix}2\`];
  }

  async count(): Promise<number> {
    return this.limit;
  }

  reset(): void {
    this.resets++;
  }
}

export async function run(): Promise<string> {
  const shelf = new Shelf();
  const described = Sources.describe(shelf);
  const raised = Sources.raise(shelf, 5);
  const listed = Sources.titles(shelf);

  shelf.limit = -1;
  const failed = Sources.titles(shelf);
  Sources.reset(shelf);

  shelf.limit = 3;
  const fetched = await Sources.fetch(shelf, "o");

  let rejected = "";
  try {
    await Sources.fetch(shelf, "!");
  } catch (e) {
    rejected = (e as Error).message;
  }

  return \`\${described}|\${raised} \${listed}|\${failed}|\${fetched}|\${rejected}|\${shelf.resets}\`;
}
`;

/** An associated type the implementing class fixes. */
const associated = `import { Stores, type Store } from "lucent:ios/Orbit";
import { available } from "lucent:ios";

class Names implements Store<string> {
  saved: string | null = null;

  load(): string | null {
    return this.saved;
  }

  save(item: string): boolean {
    this.saved = item;
    return true;
  }
}

export async function run(): Promise<string> {
  // Swift opens \`any Store<String>\` with the iOS 16 runtime.
  if (!available("ios", 16)) return "old";

  const names = new Names();
  const first = Stores.swap(names, "a");
  const second = Stores.swap(names, "b");

  return \`\${first} \${second} \${names.saved}\`;
}
`;

/** Self in requirements: another object of the implementing class. */
const self = `import { Ranking, type Ranked } from "lucent:ios/Orbit";

class Level implements Ranked {
  constructor(readonly n: number) {}

  outranks(other: Level): boolean {
    return this.n > other.n;
  }

  best(): Level {
    return new Level(this.n + 1);
  }
}

export async function run(): Promise<string> {
  return \`\${Ranking.improves(new Level(1))}\`;
}
`;

describe.skipIf(!xcode)("Swift requirements Lucent classes implement", () => {
  beforeAll(() => prepareSwiftModules(["Orbit"]), 300_000);

  it("implements property, throwing, async and mutating requirements", () => {
    const p = orbit(effects);
    const { shims, mm } = p;

    expect(p.r.diagnostics).toEqual([]);
    // Properties: a getter, and a setter where the requirement has one.
    expect(shims).toContain("var name: String {");
    expect(shims).toContain("var limit: Double {");
    expect(shims).toMatch(/set \{\n\s*r\d+_\(ctx_, newValue\)/);
    // A throwing requirement throws the error the glue gives back.
    expect(shims).toContain("func titles() throws -> [String] {");
    expect(shims).toContain("throw lucentTaken(e_) as! NSError");
    // An async requirement waits for the Lucent promise through a continuation.
    expect(shims).toContain("func fetch(_ a0: String) async throws -> [String] {");
    expect(shims).toContain("withCheckedThrowingContinuation");
    expect(shims).toContain("func count() async -> Double {");
    expect(shims).toContain("withCheckedContinuation");
    // A class implements a mutating requirement as it is.
    expect(shims).toContain("func reset() {");
    // The glue settles the continuation when the promise does, on the Lucent thread.
    expect(mm).toContain("lucent::objc::toNSError(");
    expect(compileErrors(p)).toEqual(compiles);
  }, 300_000);

  it("runs them: Swift reads and sets properties, catches errors and awaits", () => {
    expect(hostRun(orbit(effects))).toMatchObject({
      status: 0,
      stdout: "shelf 2.0|5 a b|failed: negative limit|o1 o2 of 3.0|bad prefix !|1\n",
    });
  }, 600_000);

  it("fixes associated types from the class's implements clause", () => {
    const p = orbit(associated);

    expect(p.r.diagnostics).toEqual([]);
    expect(p.shims).toContain("typealias Item = String");
    expect(p.shims).toContain("lucentObject(a0) as! any Orbit.Store<String>");
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "none a b\n" });
  }, 600_000);

  it("passes Self in requirements as the implementing class's objects", () => {
    const p = orbit(self);

    expect(p.r.diagnostics).toEqual([]);
    expect(p.shims).toMatch(/func outranks\(_ a0: LucentProxy_\w+\) -> Bool \{/);
    expect(p.shims).toMatch(/func best\(\) -> LucentProxy_\w+ \{/);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "true\n" });
  }, 600_000);

  it("refuses a Self result declared as anything but the class", { timeout: 120_000 }, () => {
    const { r } = orbit(`import type { Ranked } from "lucent:ios/Orbit";
class Level implements Ranked {
  outranks(other: Level): boolean {
    return other !== this;
  }

  best(): Ranked {
    return this;
  }
}
export async function run(): Promise<string> {
  return \`\${new Level().outranks(new Level())}\`;
}
`);

    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["LUCENT1005", "Level: Level.best returns Ranked's Self: declare it to return Level"],
    ]);
  });

  it("refuses requirements Swift would call without an object", { timeout: 120_000 }, () => {
    const { r } = orbit(`import type { Blank } from "lucent:ios/Orbit";
class Empty implements Blank {}
export async function run(): Promise<string> {
  return \`\${new Empty() !== null}\`;
}
`);

    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT1005",
        "Empty: Blank requires init(), which Swift would call to make one: Lucent classes cannot implement initializer requirements; write the conforming type in Swift (a native extension)",
      ],
    ]);
  });

  it(
    "declares associated types as type parameters, and Self as the class",
    { timeout: 120_000 },
    () => {
      const [schema] = extractIos({ modules: ["Orbit"], includePaths: [swiftModule("Orbit")] });
      const dts = sdkDts(schema!);

      expect(dts).toContain("abstract class Store<Item = unknown> {");
      expect(dts).toContain("load(): Item | null;");
      expect(dts).toContain("outranks(other: this): boolean;");
      // A `this` result would accept only `this` itself: results are the protocol.
      expect(dts).toContain("best(): Ranked;");
    },
  );
});
