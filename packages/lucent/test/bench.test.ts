import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const hasHermes = fs.existsSync(path.join(hermes, "build/lib"));

/** A project with a module and its benchmark file. */
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bench-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src/geo.lucent.ts"),
    `import { now } from "lucent:core";
export type Point = { x: number; y: number };
export function nearest(points: Point[], to: Point): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const d = (p.x - to.x) ** 2 + (p.y - to.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
export function stamp(): boolean { return now() >= 0; }
export class Grid {
  constructor(readonly size: number) {}
  cells(): number { return this.size * this.size; }
}
`,
  );
  fs.writeFileSync(
    path.join(root, "src/geo.bench.ts"),
    `import { Grid, nearest, stamp } from "./geo.lucent";
const points = Array.from({ length: 2000 }, (_, i) => ({ x: (i * 37) % 101, y: (i * 53) % 97 }));
export default {
  nearest: () => nearest(points, { x: 50, y: 50 }),
  grid: () => new Grid(64).cells(),
  core: () => stamp(),
};
`,
  );
  return root;
}

function lucent(root: string, env: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, "bench", ...args, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
    timeout: 600_000,
  });
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

describe("lucent bench", () => {
  it.skipIf(!hasHermes)(
    "times each case natively and as JavaScript, with the same results",
    () => {
      const r = lucent(project(), {}, "--json");
      expect(r.status, r.out).toBe(0);
      const { cases } = JSON.parse(r.stdout) as {
        cases: {
          file: string;
          name: string;
          js: number;
          native: number;
          speedup: number;
          same: boolean;
        }[];
      };
      expect(cases.map((c) => c.name)).toEqual(["nearest", "grid", "core"]);
      for (const c of cases) {
        expect(c.file).toBe("src/geo.bench.ts");
        expect(c.js).toBeGreaterThan(0);
        expect(c.native).toBeGreaterThan(0);
        expect(c.speedup).toBeCloseTo(c.js / c.native, 5);
        expect(c.same, c.name).toBe(true);
      }
    },
    600_000,
  );

  it.skipIf(!hasHermes)(
    "prints a speedup table",
    () => {
      const r = lucent(project(), {});
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/CASE +JS +LUCENT +SPEEDUP/);
      expect(r.out).toMatch(/nearest +\d+(\.\d+)? (µs|ms) +\d+(\.\d+)? (µs|ms) +\d+(\.\d)?x/);
    },
    600_000,
  );

  it("says how to get Hermes when there is none", () => {
    const r = lucent(project(), { HERMES_DIR: path.join(os.tmpdir(), "no-hermes-here") });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Hermes/);
    expect(r.out).toMatch(/HERMES_DIR/);
  });

  it("says when the project has no *.bench.ts file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bench-"));
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { return 1; }\n",
    );
    const r = lucent(root, {});
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no \*\.bench\.ts/);
  });
});
