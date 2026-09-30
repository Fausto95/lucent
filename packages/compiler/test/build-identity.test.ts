import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, RUNTIME_ABI } from "../src/index.ts";

/** `sources` written to a new directory; the files, in order. */
function project(
  sources: Record<string, string>,
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-identity-")),
) {
  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src);

    return f;
  });
}

function identity(sources: Record<string, string>) {
  const r = compile(project(sources));

  expect(r.diagnostics).toEqual([]);

  return r.identity!;
}

const hash = /^[0-9a-f]{16}$/;

const shapes = `export interface Point { x: number; y: number }

export enum Mode { Fast = 1, Slow = 2 }

export class Counter {
  count = 0;

  add(n: number): number {
    this.count += n;
    return this.count;
  }
}

export function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function speed(mode: Mode): number {
  return mode === Mode.Fast ? 10 : 1;
}
`;

describe("build identities", () => {
  it("hash the native program, and each module's API, with the runtime ABI they need", () => {
    const r = compile(
      project({
        "a.lucent.ts": "export function one(): number { return 1; }\n",
        "b.lucent.ts": shapes,
      }),
    );

    expect(r.identity).toEqual({
      runtimeAbi: RUNTIME_ABI,
      programs: { all: expect.stringMatching(hash) },
      apis: { all: { a: expect.stringMatching(hash), b: expect.stringMatching(hash) } },
    });
    expect(r.identity!.apis.all!.a).not.toBe(r.identity!.apis.all!.b);
  });

  it("embed the identity in the native code, which checks the runtime's ABI when it builds", () => {
    const r = compile(project({ "a.lucent.ts": "export function one(): number { return 1; }\n" }));
    const unit = r.files.get("lucent_identity.cpp")!;
    const { programs, apis } = r.identity!;

    expect(unit).toContain(`static_assert(lucent::js::kRuntimeAbi == ${RUNTIME_ABI}`);
    expect(unit).toContain(`"${programs.all}"`);
    expect(unit).toContain(`{"a", "${apis.all!.a}"}`);
    expect(unit).toContain("buildIdentity()");
  });

  it("keep the API when only a body changes, and change the program", () => {
    const before = identity({ "a.lucent.ts": shapes });
    const after = identity({ "a.lucent.ts": shapes.replace("? 10 : 1", "? 20 : 1") });

    expect(after.apis).toEqual(before.apis);
    expect(after.programs.all).not.toBe(before.programs.all);
  });

  it("keep both when an edit only moves code to other lines", () => {
    const before = identity({ "a.lucent.ts": shapes });
    const after = identity({ "a.lucent.ts": `// A comment.\n\n${shapes}` });

    expect(after).toEqual(before);
  });

  it("change the API with what JavaScript sees: signatures, exports, fields, members and enum values", () => {
    const before = identity({ "a.lucent.ts": shapes }).apis.all!.a;
    const edits = [
      shapes.replace("speed(mode: Mode)", "speed(mode: Mode, boost?: number)"),
      shapes
        .replace("add(n: number): number", "add(n: number): string")
        .replace("return this.count;", "return String(this.count);"),
      `${shapes}export const LIMIT = 3;\n`,
      shapes.replace("y: number }", "y: number; z?: number }"),
      shapes.replace("count = 0;", 'count = 0;\n  label = "";'),
      shapes.replace("Slow = 2", "Slow = 3"),
    ];

    for (const source of edits)
      expect(identity({ "a.lucent.ts": source }).apis.all!.a).not.toBe(before);
  });

  it("hash no machine path: the same sources elsewhere have the same identity", () => {
    const sources = {
      "a.lucent.ts": `${shapes}
export interface Shape { area(): number }

export class Square implements Shape {
  constructor(readonly side: number) {}

  area(): number {
    return this.side * this.side;
  }
}

export function largest(shapes: Shape[]): number {
  return Math.max(...shapes.map((s) => s.area()));
}
`,
    };

    expect(identity(sources)).toEqual(identity(sources));
  });

  it("identify each target's program apart", () => {
    const r = compile(
      project({
        "p.lucent.ts": `import { PLATFORM } from "lucent:platform";

export function name(): string {
  return PLATFORM === "ios" ? "ios" : "other";
}
`,
      }),
      { platforms: ["ios", "android", "host"] },
    );

    expect(r.diagnostics).toEqual([]);

    const { programs, apis } = r.identity!;

    expect(Object.keys(programs).sort()).toEqual(["android", "host", "ios"]);
    expect(programs.ios).not.toBe(programs.android);
    expect(apis.ios).toEqual(apis.android);
    expect(r.files.get("ios/lucent_identity.cpp")).toContain(`"${programs.ios}"`);
  });

  it("are left out of a failed compile", () => {
    const r = compile(
      project({ "a.lucent.ts": "export function one(): number { return 'x'; }\n" }),
    );

    expect(r.ok).toBe(false);
    expect(r.identity).toBeUndefined();
  });
});
