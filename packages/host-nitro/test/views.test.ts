import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";
test("registers generated hybrid native views and Fabric config", () => {
  const module = compile('import { Text, type NativeView } from "@lucent-lang/ui"; type Props = {title: string}; export function Card(props: Props): NativeView { return <Text>{props.title}</Text>; }', {fileName: "card.lucent.tsx"}).module!;
  const tree = nitroHost.emitPackage([module], {packageName: "lucent"});
  expect(tree.get("src/specs/LucentCardCardView.nitro.ts")).toContain("HybridView<");
  expect(tree.get("ios/HybridLucentCardCardView.swift")).toContain("LucentHostedView");
  expect(tree.get("android/src/main/java/com/margelo/nitro/lucent/HybridLucentCardCardView.kt")).toContain("ComposeView");
  expect(tree.get("nitro.json")).toContain("LucentCardCardView");
  expect(nitroHost.emitProxy(module).js).toContain("getHostComponent");
});
