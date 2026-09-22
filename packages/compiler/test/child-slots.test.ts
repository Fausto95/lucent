import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { generateSwiftNamespace } from "@lucent-lang/backend-swift";
import { generateKotlinNamespace } from "@lucent-lang/backend-kotlin";

const CARD = `import {VStack, Text, type NativeProps, type NativeView} from "@lucent-lang/ui";
type CardProps = { title: string; children: NativeView };
function Card(props: CardProps): NativeView {
  return (<VStack padding={12}><Text size={18}>{props.title}</Text>{props.children}</VStack>);
}
type Props = { name: string };
export function Screen(props: NativeProps<Props>): NativeView {
  return (<Card title="Hello"><Text>{props.name}</Text></Card>);
}`;

test("a component receives JSX children through its children slot", () => {
  const result = compile(CARD, { fileName: "screen.lucent.tsx" });
  expect(result.diagnostics).toEqual([]);
  const swift = generateSwiftNamespace(result.module!, "Views");
  expect(swift).toContain("var children: AnyView");
  expect(swift).toContain("children: AnyView(Text(props.name)");
  const kotlin = generateKotlinNamespace(result.module!, "Views");
  expect(kotlin).toContain("var children: @Composable () -> Unit");
  expect(kotlin).toContain("props.children()");
  expect(kotlin).toContain("children = { Text(");
});

test("several children group vertically", () => {
  const result = compile(CARD.replace("<Text>{props.name}</Text>", "<Text>a</Text><Text>b</Text>"), {
    fileName: "screen.lucent.tsx",
  });
  expect(result.diagnostics).toEqual([]);
  const swift = generateSwiftNamespace(result.module!, "Views");
  expect(swift).toContain("children: AnyView(VStack(");
});

test("a component without a slot takes no children", () => {
  const result = compile(CARD.replace("; children: NativeView", ""), { fileName: "screen.lucent.tsx" });
  expect(result.diagnostics.some((d) => d.message.includes("takes no children"))).toBe(true);
});

test("a declared slot must be filled", () => {
  const result = compile(CARD.replace("<Text>{props.name}</Text>", ""), { fileName: "screen.lucent.tsx" });
  expect(result.diagnostics.some((d) => d.message.includes("needs children for its `children` slot"))).toBe(true);
});

test("a shared component with a slot compiles on its own", () => {
  const result = compile(
    `import {VStack, Text, type NativeView} from "@lucent-lang/ui";
type PanelProps = { title: string; children: NativeView };
export function Panel(props: PanelProps): NativeView { return (<VStack><Text>{props.title}</Text>{props.children}</VStack>); }`,
    { fileName: "panel.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
});
