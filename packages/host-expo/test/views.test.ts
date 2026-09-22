import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";
test("namespaces native view events to avoid React Native bubbling event collisions", () => {
  const module = compile(
    'import {Button,type NativeView} from "@lucent-lang/ui"; import type {Event} from "@lucent-lang/events"; type Props={onPress:Event<void>}; export function Card(props:Props):NativeView{return <Button title="Go" onPress={props.onPress}/>;}',
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
    'import { Text, type NativeView } from "@lucent-lang/ui"; type Props = {title: string}; export function Card(props: Props): NativeView { return <Text>{props.title}</Text>; }',
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
    'import {TextField,type NativeView} from "@lucent-lang/ui"; import type {Event} from "@lucent-lang/events"; type Props={text:string;onChange:Event<string>}; export function Editor(props:Props):NativeView{return <TextField value={props.text} onChange={props.onChange}/>;}',
    { fileName: "editor.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const tree = expoHost.emitPackage([result.module!], { packageName: "lucent" });
  expect(tree.get("ios/LucentEditorEditorView.swift")).toContain('["payload": payload]');
  expect(expoHost.emitProxy(result.module!).js).toContain("event.nativeEvent.payload");
});
test("namespaces view storage to avoid UIKit and Android View properties", () => {
  const module = compile(
    'import {Text,type NativeView} from "@lucent-lang/ui"; type Props={enabled:boolean;alpha:number}; export function Status(props:Props):NativeView{return <Text>{props.alpha}</Text>;}',
    { fileName: "status.lucent.tsx" },
  ).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(files.get("ios/LucentStatusStatusView.swift")).toContain("var lucentProp_alpha: Double");
  expect(files.get("android/src/main/java/expo/modules/lucent/LucentStatusStatusView.kt")).toContain(
    "var lucentProp_enabled: Boolean",
  );
});
test("disposes native composition when the host view unmounts", () => {
  const module = compile(
    'import {Text,type NativeView} from "@lucent-lang/ui"; export function Label():NativeView{return <Text>Hi</Text>;}',
    { fileName: "label.lucent.tsx" },
  ).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  expect([...files.values()].join("\n")).toContain("DisposeOnDetachedFromWindowOrReleasedFromPool");
});
