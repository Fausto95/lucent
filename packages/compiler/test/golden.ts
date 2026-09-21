import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";

export const FIXTURES = join(import.meta.dir, "../../../fixtures");

export function fixtureNames(dir = FIXTURES): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".lucent.ts"))
    .map((f) => f.replace(/\.lucent\.ts$/, ""))
    .sort();
}

export function readFixture(name: string, dir = FIXTURES): { source: string; fileName: string } {
  const fileName = `${name}.lucent.ts`;
  return { source: readFileSync(join(dir, fileName), "utf8"), fileName };
}

/** Compares `actual` with the golden file; `UPDATE_GOLDEN=1` rewrites it instead. */
export function expectGolden(actual: string, goldenPath: string): void {
  if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, actual);
    if (process.env.UPDATE_GOLDEN) return;
  }
  expect(actual).toBe(readFileSync(goldenPath, "utf8"));
}
