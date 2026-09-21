import { describe, expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
const state = 'export type State = { kind: "idle" } | { kind: "ready"; value: number };';
const run = (body: string) => compile(state + body, { fileName: "state.lucent.ts" });
describe("discriminated unions", () => {
  test("supports separately named variant records", () => {
    const result = compile(`type Idle = { kind: "idle" };
      type Ready = { kind: "ready"; value: number };
      export type State = Idle | Ready;
      export function ready(n: number): State { return {kind: "ready", value:n}; }
      export function value(s: State): number { if(s.kind === "ready") { return s.value; } return 0; }
      export function payload(s: Ready): number { return s.value; }`, {fileName: "state.lucent.ts"});
    expect(result.diagnostics).toEqual([]);
  });
  test("constructs variants and narrows payload reads", () => {
    const result = run(`export function ready(n: number): State { return { kind: "ready", value: n }; }
      export function idle(): State { return { kind: "idle" }; }
      export function value(s: State): number { if (s.kind === "ready") { return s.value; } return 0; }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.module?.structs[0]).toHaveProperty("union");
  });
  test.each([
    'export function f(): State { return { kind: "unknown" }; }',
    'export function f(): State { return { kind: "ready" }; }',
    'export function f(): State { return { kind: "idle", value: 1 }; }',
    "export function f(s: State): number { return s.value; }",
    'export function f(s: State): void { s.kind = "ready"; }',
  ])("rejects invalid union operations: %s", (source) => {
    expect(run(source).diagnostics.length).toBeGreaterThan(0);
  });
  test("narrows the remaining branch after early return", () => {
    expect(
      run('export function f(s: State): number { if (s.kind === "idle") { return 0; } return s.value; }').diagnostics,
    ).toEqual([]);
  });
  test("rejects duplicate tags", () => {
    expect(
      compile('type Bad = { kind: "same"; a: number } | { kind: "same"; b: string };', { fileName: "bad.lucent.ts" })
        .diagnostics.length,
    ).toBeGreaterThan(0);
  });
});
