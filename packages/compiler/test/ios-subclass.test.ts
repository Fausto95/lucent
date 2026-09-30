import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  xcode,
} from "./swift-harness.ts";

const messages = (p: ReturnType<typeof iosProgram>) =>
  p.r.diagnostics.map((d) => [d.code, d.message]);

/**
 * A Foundation class Foundation calls back: start() runs main(), which the
 * Lucent class overrides, calling the base's with super and setting an
 * inherited property on itself.
 */
const operations = `import { Operation } from "lucent:ios/Foundation";

class Job extends Operation {
  runs = 0;

  constructor(readonly label: string) {
    super();
    this.name = \`\${label} made\`;
  }

  main(): void {
    super.main();
    this.runs++;
    this.name = \`\${this.label} ran \${this.isExecuting}\`;
  }

  describe(): string {
    return \`\${this.runs} \${this.name} \${this.isFinished}\`;
  }
}

/** An SDK parameter of the base's type takes the Lucent object's native one. */
function follow(after: Operation, before: Operation): number {
  after.addDependency(before);
  return after.dependencies.length;
}

export async function run(): Promise<string> {
  const job = new Job("a");
  const made = job.name;
  job.start();

  const skipped = new Job("b");
  skipped.cancel();
  skipped.start();

  const deps = follow(new Job("c"), job);

  return \`\${made}|\${job.describe()}|\${skipped.describe()} \${skipped.isCancelled}|\${deps}\`;
}
`;

/** A view controller UIKit shows: its overrides run on the main thread. */
const controller = `import { UIColor, UILabel, UIViewController } from "lucent:ios/UIKit";
import { present } from "lucent:ios";

class Greeting extends UIViewController {
  appeared = 0;

  constructor(readonly text: string) {
    super(null, null);
  }

  viewDidLoad(): void {
    super.viewDidLoad();
    const label = new UILabel();
    label.text = this.text;
    // UIKit declares it implicitly unwrapped: loaded by now.
    const view = this.view!;
    view.backgroundColor = UIColor.systemBackground;
    view.addSubview(label);
  }

  viewDidAppear(animated: boolean): void {
    super.viewDidAppear(animated);
    this.appeared++;
    this.dismiss(animated, () => {});
  }
}

export async function run(): Promise<string> {
  await present<void>((resolve) => {
    const greeting = new Greeting("hello");
    greeting.title = "Greeting";
    resolve();
    return greeting;
  });
  return "shown";
}
`;

describe.skipIf(!xcode)("Lucent classes extending Objective-C classes", () => {
  beforeAll(() => prepareSwiftModules(["Orbit"]), 300_000);

  it("constructs, overrides and calls the base, run on the host", () => {
    const p = iosProgram(operations);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({
      status: 0,
      stdout: "a made|1 a ran true true|0 b made true true|1\n",
    });
  }, 600_000);

  it("subclasses UIKit view controllers, used on the main thread", () => {
    const p = iosProgram(controller);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
  }, 300_000);

  it("keeps a main-thread base's subclass on the main thread", () => {
    const p = iosProgram(`import { UIView } from "lucent:ios/UIKit";
class Badge extends UIView {}
export async function run(): Promise<string> {
  return \`\${new Badge() !== null}\`;
}
`);

    expect(messages(p)).toEqual([
      [
        "LUCENT3006",
        "Badge can only be used on the main thread: call it inside main(() => …) from lucent:thread",
      ],
    ]);
  });

  it("refuses what the subclass cannot be", { timeout: 300_000 }, () => {
    const refused = (src: string) => messages(iosProgram(src, ["Orbit"]));

    // A Lucent class extending one that extends an SDK class.
    expect(
      refused(`import { Operation } from "lucent:ios/Foundation";
class Job extends Operation {}
class Chore extends Job {}
export async function run(): Promise<string> {
  return \`\${new Chore() !== null}\`;
}
`),
    ).toEqual([
      [
        "LUCENT1005",
        "Chore: Job extends Operation, an iOS class: Lucent classes cannot extend it in turn",
      ],
    ]);
    // A field where the base has a property: the base would not see it.
    expect(
      refused(`import { Operation } from "lucent:ios/Foundation";
class Named extends Operation {
  name = "x";
}
export async function run(): Promise<string> {
  return \`\${new Named() !== null}\`;
}
`),
    ).toEqual([
      [
        "LUCENT1005",
        "Named.name: Operation has a property of that name; set it (this.name = …) instead of declaring a field",
      ],
    ]);
    // Swift classes need a Swift subclass.
    expect(
      refused(`import { Feed } from "lucent:ios/Orbit";
class Mine extends Feed {}
export async function run(): Promise<string> {
  return \`\${new Mine() !== null}\`;
}
`),
    ).toEqual([
      [
        "LUCENT1005",
        "Mine: Feed is a Swift class: Lucent classes extend Objective-C classes only; subclass it in Swift (a native extension)",
      ],
    ]);
  });
});
