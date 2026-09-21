import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateKotlin } from "../src/index.ts";
test("emits native binding bodies and dispatcher hops", () => {
  const result = compile(
    'import { now } from "@lucent-lang/platform/clock"; @MainThread export async function f(): Promise<number> { return now(); }',
    { fileName: "clock.lucent.ts" },
  );
  const code = generateKotlin(result.module!).code;
  expect(code).toContain("System.currentTimeMillis()");
  expect(code).toContain("withContext(kotlinx.coroutines.Dispatchers.Main)");
  expect(code).toContain("return@withContext");
});

test("preserves stack orientation with VStack and HStack", () => {
  const result = compile(
    'import {VStack,HStack,Text,type NativeView} from "@lucent-lang/ui"; export function Card():NativeView{return <VStack spacing={12}><HStack spacing={4}><Text>Hello</Text></HStack></VStack>;}',
    { fileName: "card.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const code = generateKotlin(result.module!).code;
  expect(code).toContain("Column(");
  expect(code).toContain("Row(");
});
