import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";
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
