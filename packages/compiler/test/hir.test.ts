import { describe, expect, test } from "vite-plus/test";
import { compile, nativeSymbolId, printIR, validateHIR, type LibraryModule } from "../src/index.ts";

const library: LibraryModule = {
  schemaVersion: 1,
  source: `export type Session = {};
export declare function Session__create(): Session;
export declare function Session__method_start(lucentSelf: Session): Promise<void>;`,
  references: {
    Session: {
      swift: "Session",
      kotlin: "Session",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings: {
    Session__create: {
      contract: { symbolId: nativeSymbolId("Test", "Session", "create", "v1"), result: "owned" },
      swift: ["return Session()"],
      kotlin: ["return Session()"],
    },
    Session__method_start: {
      contract: {
        symbolId: nativeSymbolId("Test", "Session", "start", "v1"),
        cancellation: "cooperative",
      },
      swift: ["try await lucentSelf.start()"],
      kotlin: ["lucentSelf.start()"],
    },
  },
};

describe("HIR call semantics", () => {
  test("Lucent-to-Lucent calls carry value ownership without a symbol id", () => {
    const result = compile(
      `export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`,
      { fileName: "fib.lucent.ts" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.module).not.toBeNull();
    const text = printIR(result.module!);
    expect(text).toContain("(call fibonacci {value->value}");
    expect(text).not.toContain("#");
    expect(validateHIR(result.module!)).toEqual([]);
  });

  test("native calls carry symbol id, ownership, and cancellation", () => {
    const result = compile(
      `import { Session } from "@test/session";
export function make(): Session { return new Session(); }
export async function start(session: Session): Promise<void> { await session.start(); }`,
      { fileName: "session.lucent.ts", libraries: { "@test/session": library } },
    );
    expect(result.diagnostics.map((d) => d.message)).toEqual([]);
    expect(result.module).not.toBeNull();
    const text = printIR(result.module!);
    expect(text).toContain(`#${nativeSymbolId("Test", "Session", "start", "v1")}`);
    expect(text).toContain("native");
    expect(text).toContain("async");
    expect(text).toContain("cancel=cooperative");
    expect(validateHIR(result.module!)).toEqual([]);
  });

  test("functions calling Session__method_start are marked native", () => {
    const result = compile(
      `import { Session } from "@test/session";
export function make(): Session { return new Session(); }
export async function start(session: Session): Promise<void> { await session.start(); }`,
      { fileName: "session-effects.lucent.ts", libraries: { "@test/session": library } },
    );
    expect(result.diagnostics).toEqual([]);
    const start = result.module!.functions.find((f) => f.name === "start");
    expect(start?.effects).toMatchObject({ async: true, native: true });
    expect(printIR(result.module!)).toMatch(/async fn start\([^)]*\) -> void \[native async/);
  });
});
