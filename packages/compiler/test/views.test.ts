import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
const source = `import { VStack, HStack, Text, Spacer, type NativeView } from "@lucent-lang/ui";
type Props = { title: string; count: number };
export function Card(props: Props): NativeView {
  return <VStack spacing={12} padding={16}><Text>{props.title}</Text><HStack><Text>{props.count}</Text><Spacer /></HStack></VStack>;
}`;
test("compiles declarative native views from TSX", () => {
  const result = compile(source, { fileName: "card.lucent.tsx" });
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions[0]?.returnType.kind).toBe("view");
});
test("rejects unknown native primitives and invalid props", () => {
  for (const invalid of [
    source.replace("spacing={12}", 'spacing={"bad"}'),
    source.replaceAll("Spacer", "UnknownView"),
  ]) {
    expect(compile(invalid, { fileName: "card.lucent.tsx" }).diagnostics.length).toBeGreaterThan(0);
  }
});
test("composes imported native views", () => {
  const result = compile(
    `import { Card } from "./card.lucent.tsx";
    import type { NativeView } from "@lucent-lang/ui";
    type Props = {title: string; count: number};
    export function Screen(props: Props): NativeView { return <Card title={props.title} count={props.count} />; }`,
    { fileName: "screen.lucent.tsx", sources: { "card.lucent.tsx": source } },
  );
  expect(result.diagnostics).toEqual([]);
});

test("rejects effectful rendering and unsupported view boundaries", () => {
  const bad = [
    source.replace("return <VStack", 'throw new Error("FAIL"); return <VStack'),
    source.replace("title: string;", "title: string[];"),
    source.replace("return <VStack", "props.count += 1; return <VStack"),
  ];
  for (const text of bad) expect(compile(text, { fileName: "card.lucent.tsx" }).diagnostics.length).toBeGreaterThan(0);
});

test("NativeProps provides the React Native wrapper surface", () => {
  const text = source
    .replace("type NativeView", "type NativeProps, type NativeView")
    .replace("Card(props: Props)", "Card(props: NativeProps<Props>)");
  expect(compile(text, { fileName: "card.lucent.tsx" }).diagnostics).toEqual([]);
});

test.each(["Column", "Row"])("rejects obsolete stack name %s", (name) => {
  const result = compile(`import { ${name}, type NativeView } from "@lucent-lang/ui"; export function Card():NativeView { return <${name} />; }`, {fileName:"card.lucent.tsx"});
  expect(result.module).toBeNull();
});
