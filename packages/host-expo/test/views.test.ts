import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { exportedViews } from "@lucent-lang/host-core";
import { expoHost } from "../src/index.ts";
test("namespaces native view events to avoid React Native bubbling event collisions", () => {
  const module = compile(
    'import {Button,type NativeView} from "@lucent-lang/core/ui"; import type {Event} from "@lucent-lang/core/events"; type Props={onPress:Event<void>}; export function Card(props:Props):NativeView{return <Button title="Go" onPress={props.onPress}/>;}',
    { fileName: "card.lucent.tsx" },
  ).module!;
  const tree = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("ios/LucentCardCardView.swift")).toContain('Events("onLucentCardCardView_onPress")');
  expect(tree.get("android/src/main/java/expo/modules/lucent/LucentCardCardView.kt")).toContain(
    'Events("onLucentCardCardView_onPress")',
  );
  expect(expoHost.emitProxy(module).js).toContain("onLucentCardCardView_onPress: props.onPress");
});
test("registers generated SwiftUI and Compose native views", () => {
  const module = compile(
    'import { Text, type NativeView } from "@lucent-lang/core/ui"; type Props = {title: string}; export function Card(props: Props): NativeView { return <Text>{props.title}</Text>; }',
    { fileName: "card.lucent.tsx" },
  ).module!;
  const tree = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("ios/LucentCardCardView.swift")).toContain("LucentHostedView");
  expect(tree.get("ios/LucentCardCardView.swift")).toContain("public final class LucentCardCardViewModule");
  expect(tree.get("android/src/main/java/expo/modules/lucent/LucentCardCardView.kt")).toContain("ComposeView");
  expect(tree.get("expo-module.config.json")).toContain("LucentCardCardViewModule");
  expect(expoHost.emitProxy(module).js).toContain("requireNativeViewManager");
  expect(expoHost.emitProxy(module).dts).toContain("ComponentType");
});
test("bridges typed native view change payloads", () => {
  const result = compile(
    'import {TextField,type NativeView} from "@lucent-lang/core/ui"; import type {Event} from "@lucent-lang/core/events"; type Props={text:string;onChange:Event<string>}; export function Editor(props:Props):NativeView{return <TextField value={props.text} onChange={props.onChange}/>;}',
    { fileName: "editor.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const tree = expoHost.emitPackage([result.module!], { packageName: "lucent" });
  expect(tree.get("ios/LucentEditorEditorView.swift")).toContain('["payload": payload]');
  expect(expoHost.emitProxy(result.module!).js).toContain("event.nativeEvent.payload");
});
test("namespaces view storage to avoid UIKit and Android View properties", () => {
  const module = compile(
    'import {Text,type NativeView} from "@lucent-lang/core/ui"; type Props={enabled:boolean;alpha:number}; export function Status(props:Props):NativeView{return <Text>{props.alpha}</Text>;}',
    { fileName: "status.lucent.tsx" },
  ).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(files.get("ios/LucentStatusStatusView.swift")).toContain("var lucentProp_alpha: Double");
  expect(files.get("android/src/main/java/expo/modules/lucent/LucentStatusStatusView.kt")).toContain(
    "var lucentProp_enabled: Boolean",
  );
});
test("keeps view state on the host instance and does not reset it when props update", () => {
  const module = compile(
    `import { Text, Button, type NativeView } from "@lucent-lang/core/ui";
export function Counter(): NativeView {
  const taps = state(1);
  return <Button title="Add" onPress={() => taps.set(taps + 1)} />;
}`,
    { fileName: "counter.lucent.tsx" },
  ).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  const swift = files.get("ios/LucentCounterCounterView.swift")!;
  const kotlin = files.get("android/src/main/java/expo/modules/lucent/LucentCounterCounterView.kt")!;
  const namespace = [...files.values()].join("\n");
  expect(swift).toContain("var lucentState_taps: Double = 1");
  expect(swift).not.toContain("lucentState_taps = 1");
  expect(swift).toContain("self?.lucentState_taps = value");
  expect(kotlin).toContain("var lucentState_taps: Double by mutableStateOf(1.0)");
  expect(namespace).toContain("lucentGet_taps: @escaping () -> Double");
  expect(namespace).toContain("lucentSet_taps");
});
test("emits eager rows and a divider", () => {
  const module = compile(
    `import { VStack, Text, Divider, For, type NativeView } from "@lucent-lang/core/ui";
type Props = { notes: string[] };
export function Notes(props: Props): NativeView {
  return <VStack>{props.notes.length > 0 ? <Divider /> : <Text>Empty</Text>}<For each={props.notes}>{(note: string) => <Text>{note}</Text>}</For></VStack>;
}`,
    { fileName: "notes.lucent.tsx" },
  ).module!;
  const code = [...expoHost.emitPackage([module], { packageName: "lucent" }).values()].join("\n");
  expect(code).toContain("ForEach");
  expect(code).toContain("Divider()");
  expect(code).toContain("HorizontalDivider()");
  expect(code).toContain("for (lucentIndex in");
});
test("disposes native composition when the host view unmounts", () => {
  const module = compile(
    'import {Text,type NativeView} from "@lucent-lang/core/ui"; export function Label():NativeView{return <Text>Hi</Text>;}',
    { fileName: "label.lucent.tsx" },
  ).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  expect([...files.values()].join("\n")).toContain("DisposeOnDetachedFromWindowOrReleasedFromPool");
});

test("a component with a child slot is not mounted from React", () => {
  const result = compile(
    `import {VStack, Text, type NativeView} from "@lucent-lang/core/ui";
type PanelProps = { title: string; children: NativeView };
export function Panel(props: PanelProps): NativeView { return (<VStack><Text>{props.title}</Text>{props.children}</VStack>); }`,
    { fileName: "panel.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(exportedViews(result.module!)).toEqual([]);
  expect(expoHost.emitProxy(result.module!).dts).not.toContain("Panel");
});
