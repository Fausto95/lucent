import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import type { LibraryModule } from "@lucent-lang/compiler";
import { generateSwift } from "../src/index.ts";

/** A package binding, the only way a platform API reaches Lucent source. */
const CLOCK_LIBRARY: Record<string, LibraryModule> = {
  "@lucent-lang/example-clock": {
    source: "export declare function now():number;",
    bindings: {
      now: {
        swift: ["return Date().timeIntervalSince1970 * 1000"],
        kotlin: ["return System.currentTimeMillis().toDouble()"],
        swiftImports: ["Foundation"],
        capabilities: ["clock"],
      },
    },
  },
};
test("emits native binding bodies and actor isolation", () => {
  const result = compile(
    'import { now } from "@lucent-lang/example-clock"; @MainThread export async function f(): Promise<number> { return now(); }',
    { fileName: "clock.lucent.ts", libraries: CLOCK_LIBRARY },
  );
  const code = generateSwift(result.module!).code;
  expect(code).toContain("Date().timeIntervalSince1970");
  expect(code).toContain("@MainActor");
});

test("preserves stack orientation with VStack and HStack", () => {
  const result = compile(
    'import {VStack,HStack,Text,type NativeView} from "@lucent-lang/core/ui"; export function Card():NativeView{return <VStack spacing={12}><HStack spacing={4}><Text>Hello</Text></HStack></VStack>;}',
    { fileName: "card.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const code = generateSwift(result.module!).code;
  expect(code).toContain("VStack(");
  expect(code).toContain("HStack(");
});
