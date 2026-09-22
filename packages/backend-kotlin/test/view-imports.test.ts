import { describe, expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateKotlin } from "../src/index.ts";

/**
 * Compose imports are derived from the views a module actually emits. A blanket
 * list maintained beside the render table drifts from it, and every generated
 * file pays for the widest module's needs.
 */
const importsFor = (body: string, tags: string): string[] => {
  const source = `import {${tags},type NativeView} from "@lucent-lang/core/ui"; export function Screen():NativeView{return ${body};}`;
  const result = compile(source, { fileName: "screen.lucent.tsx" });
  expect(result.diagnostics).toEqual([]);
  return generateKotlin(result.module!).imports;
};

describe("kotlin view imports", () => {
  test("a text-only screen imports neither layout nor Modifier", () => {
    const imports = importsFor("<Text>hi</Text>", "Text");
    expect(imports).toContain("androidx.compose.material3.*");
    expect(imports).not.toContain("androidx.compose.foundation.layout.*");
    expect(imports).not.toContain("androidx.compose.ui.Modifier");
    expect(imports).not.toContain("androidx.compose.ui.unit.dp");
  });

  test("Color is imported only when a colour is set", () => {
    expect(importsFor("<Text>hi</Text>", "Text")).not.toContain("androidx.compose.ui.graphics.Color");
    expect(importsFor('<Text color="#ff0000">hi</Text>', "Text")).toContain("androidx.compose.ui.graphics.Color");
  });

  test("a stack pulls in layout, Modifier and dp", () => {
    const imports = importsFor("<VStack spacing={4}><Text>hi</Text></VStack>", "VStack,Text");
    expect(imports).toContain("androidx.compose.foundation.layout.*");
    expect(imports).toContain("androidx.compose.ui.Modifier");
    expect(imports).toContain("androidx.compose.ui.unit.dp");
  });

  test("scrolling pulls in its own foundation helpers, and nothing else does", () => {
    expect(importsFor("<ScrollView><Text>hi</Text></ScrollView>", "ScrollView,Text")).toContain(
      "androidx.compose.foundation.rememberScrollState",
    );
    expect(importsFor("<VStack><Text>hi</Text></VStack>", "VStack,Text")).not.toContain(
      "androidx.compose.foundation.rememberScrollState",
    );
  });

  test("every view function still gets the Composable annotation import", () => {
    expect(importsFor("<Text>hi</Text>", "Text")).toContain("androidx.compose.runtime.Composable");
  });
});
