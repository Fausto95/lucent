import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { extractSwiftSymbolGraph, generateBindingLibrary } from "../src/index.ts";
const input = readFileSync(new URL("./fixtures/probe.symbols.json", import.meta.url), "utf8");
test("reads compiler-produced symbol graphs with overloads, labels and coverage", () => {
  const schema = extractSwiftSymbolGraph(input);
  expect(schema.functions).toHaveLength(3);
  expect(schema.functions.filter((f) => f.name === "magnitude")).toHaveLength(2);
  expect(schema.functions.find((f) => f.name === "greeting")?.parameters[0]?.label).toBe("name");
  expect(schema.coverage?.filter((c) => c.status === "skipped")).toHaveLength(3);
  expect(schema.coverage?.find((c) => c.kind === "swift.protocol")?.reason).toContain("Unsupported symbol kind");
  expect(schema.extraction?.inputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(schema.extraction?.generator).toContain("Apple Swift version 6.4");
  const generated = generateBindingLibrary(schema);
  expect(generated.declarations.match(/function magnitude/g)).toHaveLength(2);
  expect(generated.library.bindings?.greeting?.swift.join("\n")).toContain("Probe.greeting(name: name)");
});
test("rejects unsupported graph formats and malformed containers", () => {
  expect(() => extractSwiftSymbolGraph("{}")).toThrow("Invalid Swift symbol graph");
  const graph = JSON.parse(input);
  graph.metadata.formatVersion.major = 1;
  expect(() => extractSwiftSymbolGraph(JSON.stringify(graph))).toThrow("Unsupported Swift symbol graph version");
});
test("records unsupported effects and availability instead of dropping contracts", () => {
  const graph = JSON.parse(input);
  const fn = graph.symbols.find((s: { kind: { identifier: string } }) => s.kind.identifier === "swift.func");
  fn.availability = [{ domain: "iOS", introduced: { major: 19 } }];
  const schema = extractSwiftSymbolGraph(JSON.stringify(graph));
  expect(schema.coverage?.find((c) => c.symbolId === fn.identifier.precise)?.reason).toContain("availability");
});

test("symbol identities and generated aliases survive graph reordering", () => {
  const graph = JSON.parse(input);
  graph.symbols.reverse();
  const first = generateBindingLibrary(extractSwiftSymbolGraph(input));
  const second = generateBindingLibrary(extractSwiftSymbolGraph(JSON.stringify(graph)));
  expect(second).toEqual(first);
});

test("duplicate identities are rejected instead of producing duplicate bindings", () => {
  const graph = JSON.parse(input);
  graph.symbols.push(graph.symbols[0]);
  expect(() => extractSwiftSymbolGraph(JSON.stringify(graph))).toThrow("Duplicate Swift symbol identity");
});
