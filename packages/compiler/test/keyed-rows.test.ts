import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { generateSwift } from "@lucent-lang/backend-swift";
import { generateKotlin } from "@lucent-lang/backend-kotlin";

const view = (forTag: string) =>
  `import {For, Text, VStack, type NativeProps, type NativeView} from "@lucent-lang/core/ui";
type Props = { notes: string[] };
export function List(props: NativeProps<Props>): NativeView {
  return (<VStack>${forTag}</VStack>);
}`;

const compileView = (forTag: string) => compile(view(forTag), { fileName: "list.lucent.tsx" });

test("rows keep index identity when no key is given", () => {
  const result = compileView("<For each={props.notes}>{(note: string) => <Text>{note}</Text>}</For>");
  expect(result.diagnostics).toEqual([]);
  expect(generateSwift(result.module!).code).toContain("id: \\.offset");
  expect(generateKotlin(result.module!).code).toContain("lucentIndex in");
});

test("a key closure gives each row a stable identity", () => {
  const result = compileView(
    "<For each={props.notes} by={(note: string) => note}>{(note: string) => <Text>{note}</Text>}</For>",
  );
  expect(result.diagnostics).toEqual([]);
  const swift = generateSwift(result.module!).code;
  expect(swift).toContain("lucentKeyedRows(");
  expect(swift).toContain("id: \\.id");
  const kotlin = generateKotlin(result.module!).code;
  expect(kotlin).toContain("lucentKeyedRows(");
  expect(kotlin).toContain("key(lucentRow.first)");
});

test("a key closure must produce a string", () => {
  const result = compileView(
    "<For each={props.notes} by={(note: string) => 1}>{(note: string) => <Text>{note}</Text>}</For>",
  );
  expect(result.diagnostics[0]?.code).toBe("LUCENT1011");
  expect(result.diagnostics[0]?.message).toContain("Expected `string`");
});

test("a key that is not a closure is rejected", () => {
  const result = compileView("<For each={props.notes} by={props.notes}>{(note: string) => <Text>{note}</Text>}</For>");
  expect(result.diagnostics.some((d) => d.message.includes("closure from the row value to a string"))).toBe(true);
});

test("unknown For props are rejected", () => {
  const result = compileView("<For each={props.notes} spacing={4}>{(note: string) => <Text>{note}</Text>}</For>");
  expect(result.diagnostics.some((d) => d.message.includes("`each` array and an optional `by`"))).toBe(true);
});

test("the old JSX key selector is not retained as an alias", () => {
  const result = compileView(
    "<For each={props.notes} key={(note: string) => note}>{(note: string) => <Text>{note}</Text>}</For>",
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics[0]?.message).toContain("optional `by`");
});
