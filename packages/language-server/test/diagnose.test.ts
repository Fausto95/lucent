import { expect, test } from "vite-plus/test";
import type { LibraryModule } from "@lucent-lang/compiler";
import { createLanguageService } from "../src/index.ts";

const bufLibrary: LibraryModule = {
  schemaVersion: 1,
  source: `export type Buffer = { length: number };
export declare function Buffer__create():Buffer;
export declare function Buffer__get_length(lucentSelf:Buffer):number;
export declare function Buffer__method_close(lucentSelf:Buffer):void;
export declare function borrow():Buffer;`,
  references: {
    Buffer: { swift: "Buf", kotlin: "Buf", contract: { ownership: "owned", executor: "main", close: "close" } },
  },
  bindings: {
    Buffer__create: {
      contract: { symbolId: "buf.init", result: "owned", executor: "main" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Buffer__get_length: {
      contract: { symbolId: "buf.length", executor: "main" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    Buffer__method_close: {
      contract: { symbolId: "buf.close", executor: "main" },
      swift: ["lucentSelf.close()"],
      kotlin: ["lucentSelf.close()"],
    },
    borrow: {
      contract: { symbolId: "buf.borrow", result: "borrowed", executor: "main" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
  },
};

const borrowAfterAwait = `import { borrow } from "@lucent-lang/sdk/buf";

async function pause(): Promise<number> {
  return 1;
}

@MainThread
export async function later(): Promise<number> {
  const buffer = borrow();
  await pause();
  return buffer.length;
}
`;

test("diagnose returns LUCENT1018 for borrow-after-await", () => {
  const ls = createLanguageService({ libraries: { "@lucent-lang/sdk/buf": bufLibrary } });
  const diagnostics = ls.diagnose(borrowAfterAwait, "negative-borrow-after-await.lucent.ts");
  expect(diagnostics.some((d) => d.code === "LUCENT1018")).toBe(true);
});

test("hoverSymbol returns name and type for a function identifier", () => {
  const ls = createLanguageService();
  const source = "export function add(a: number, b: number): number { return a + b; }";
  const offset = source.indexOf("add");
  expect(ls.hoverSymbol(source, "a.lucent.ts", offset)).toBe("add: (a: float64, b: float64) -> float64");
});

test("hoverSymbol returns type for a parameter identifier", () => {
  const ls = createLanguageService();
  const source = "export function add(a: number, b: number): number { return a + b; }";
  const offset = source.indexOf("a:");
  expect(ls.hoverSymbol(source, "a.lucent.ts", offset)).toBe("a: float64");
});

test("hoverSymbol returns null for non-identifiers", () => {
  const ls = createLanguageService();
  expect(ls.hoverSymbol("export function f(): number { return 1; }", "a.lucent.ts", 0)).toBeNull();
});

test("gotoDefinition finds a local function name span", () => {
  const ls = createLanguageService();
  const source = `function helper(): number { return 1; }
export function live(): number { return helper(); }`;
  const useOffset = source.lastIndexOf("helper");
  const def = ls.gotoDefinition(source, "nav.lucent.ts", useOffset);
  expect(def).not.toBeNull();
  expect(def!.fileName).toBe("nav.lucent.ts");
  expect(source.slice(def!.start, def!.end)).toBe("helper");
  expect(def!.start).toBe(source.indexOf("helper"));
});

test("gotoDefinition finds an import binding span", () => {
  const ls = createLanguageService();
  const source = `import { add } from "./math.lucent.ts";
export function live(): number { return add(1, 2); }`;
  const useOffset = source.lastIndexOf("add");
  const def = ls.gotoDefinition(source, "nav.lucent.ts", useOffset);
  expect(def).not.toBeNull();
  expect(source.slice(def!.start, def!.end)).toBe("add");
  expect(def!.start).toBe(source.indexOf("add"));
});

test("findReferences returns definition and uses within the module", () => {
  const ls = createLanguageService();
  const source = `function helper(): number { return 1; }
export function live(): number { return helper() + helper(); }`;
  const refs = ls.findReferences(source, "refs.lucent.ts", source.indexOf("helper"));
  expect(refs.length).toBeGreaterThanOrEqual(2);
  for (const ref of refs) {
    expect(ref.fileName).toBe("refs.lucent.ts");
    expect(source.slice(ref.start, ref.end)).toBe("helper");
  }
});
