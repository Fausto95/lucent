import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";
test("registers generated hybrid native views and Fabric config", () => {
  const module = compile(
    'import { Text, type NativeView } from "@lucent-lang/ui"; type Props = {title: string}; export function Card(props: Props): NativeView { return <Text>{props.title}</Text>; }',
    { fileName: "card.lucent.tsx" },
  ).module!;
  const tree = nitroHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("src/specs/LucentCardCardView.nitro.ts")).toContain("HybridView<");
  expect(tree.get("ios/HybridLucentCardCardView.swift")).toContain("LucentHostedView");
  expect(tree.get("android/src/main/java/com/margelo/nitro/lucent/HybridLucentCardCardView.kt")).toContain(
    "ComposeView",
  );
  expect(tree.get("nitro.json")).toContain("LucentCardCardView");
  expect(nitroHost.emitProxy(module).js).toContain("getHostComponent");
});

test("imports the generated Fabric managers from their views package", () => {
  const module = compile(
    'import {Text,type NativeView} from "@lucent-lang/ui"; export function Label():NativeView{return <Text>Hi</Text>;}',
    { fileName: "label.lucent.tsx" },
  ).module!;
  const tree = nitroHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("android/src/main/java/com/margelo/nitro/lucent/LucentPackage.kt")).toContain(
    "import com.margelo.nitro.lucent.views.HybridLucentLabelLabelViewManager",
  );
});
test("escapes exported C++ method keywords without changing the JS API", () => {
  const module = compile("export function double(value:number):number{return value*2;}", {
    fileName: "math.lucent.ts",
  }).module!;
  const tree = nitroHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("src/specs/Math.nitro.ts")).toContain("lucent_double(");
  expect(nitroHost.emitProxy(module).js).toContain("export function double(");
  expect(nitroHost.emitProxy(module).js).toContain("native.lucent_double(");
});
