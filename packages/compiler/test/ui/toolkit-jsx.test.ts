// The JSX a platform's Lucent files write (LUCENT_VIEWS=fabric) is its
// toolkit's: the program resolves each file's implicit JSX runtime import
// to its platform's toolkit module, whose JSX namespace types it. A shared
// file writes no toolkit's JSX. A component returning a toolkit's JSX is
// that toolkit's: its root is the toolkit's root class.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "../../src/index.ts";
import { builtinSdkModuleOf, createLucentProgram, jsxRuntimeOf } from "../../src/program.ts";
import { returnShape, sdkRoot } from "../../src/ui/roots.ts";
import { bodyOf, isToolkitBody, jsxRoot } from "../../src/ui/toolkit-body.ts";
import { jsxToolkits } from "../../src/ui/toolkit-modules.ts";

const ios = sdkAvailable("ios");

function program(files: Record<string, string>, platform?: "ios" | "android") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-jsx-"));
  const paths = Object.entries(files).map(([name, text]) => {
    const file = path.join(dir, name);

    fs.writeFileSync(file, text);
    return file;
  });

  return createLucentProgram(paths, undefined, platform);
}

/** The first JSX element of a program's file. */
function firstJsx(sf: ts.SourceFile): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (n: ts.Node): void => {
    if (!found && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n))) found = n;

    ts.forEachChild(n, visit);
  };

  visit(sf);
  return found!;
}

describe("toolkit JSX", () => {
  beforeEach(() => {
    process.env.LUCENT_VIEWS = "fabric";
  });

  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("resolves each platform file's JSX runtime to its toolkit", () => {
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/toggle.ios.lucent.tsx")).toBe(
      "lucent:swiftui",
    );
    expect(jsxRuntimeOf("lucent:jsx/jsx-dev-runtime", "/a/toggle.android.lucent.tsx")).toBe(
      "lucent:compose",
    );
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/toggle.lucent.tsx")).toBeNull();
    expect(jsxRuntimeOf("lucent:swiftui", "/a/toggle.ios.lucent.tsx")).toBeUndefined();
    expect(jsxToolkits()).toEqual({ ios: "swiftui", android: "compose" });
  });

  it.skipIf(!ios)("types an iOS file's JSX with lucent:swiftui", () => {
    const lp = program(
      {
        "a.ios.lucent.tsx": `import { Text } from "lucent:swiftui";\nexport const hello = <Text>hi</Text>;\n`,
      },
      "ios",
    );
    const sf = lp.modules[0]!.sourceFile;
    const element = lp.checker.getTypeAtLocation(firstJsx(sf));
    const decl = element.getSymbol()?.declarations?.[0];

    expect(lp.checker.typeToString(element)).toBe("View");
    expect(decl && builtinSdkModuleOf(decl.getSourceFile())).toBe("lucent:swiftui");
    expect(lp.diagnostics.map((d) => d.message).filter((m) => /TS(2875|7026)/.test(m))).toEqual([]);
  });

  it("refuses JSX in a file of no platform", () => {
    const lp = program({ "a.lucent.tsx": "export const x = <div>{1}</div>;\n" });

    expect(lp.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT3024",
        "JSX is a component's body, written with its platform's toolkit: write it in a platform file (`*.ios.lucent.tsx` for SwiftUI, `*.android.lucent.tsx` for Compose)",
      ],
    ]);
  });

  it.skipIf(!ios)("makes a component returning SwiftUI's JSX a SwiftUI component", () => {
    const lp = program(
      {
        "a.ios.lucent.tsx": `import { Text } from "lucent:swiftui";\nexport function Hello() {\n  return <Text>hi</Text>;\n}\n`,
      },
      "ios",
    );
    const fn = lp.modules[0]!.sourceFile.statements.find(ts.isFunctionDeclaration)!;
    const shape = returnShape(lp.checker, fn, "ios", sdkRoot);

    expect(shape.kind === "view" && shape.root.name?.text).toBe("UIHostingController");
  });

  describe("the body", () => {
    /** The setup `Hello` of an iOS file whose code is `code`, in its program. */
    function hello(code: string) {
      const lp = program(
        {
          "hello.ios.lucent.tsx": `import { Text } from "lucent:swiftui";\nimport { signal } from "lucent:ui";\n\nexport function Hello() {\n${code}\n}\n`,
        },
        "ios",
      );
      const fn = lp.modules[0]!.sourceFile.statements.find(ts.isFunctionDeclaration)!;

      return { lp, fn };
    }

    it.skipIf(!ios)("is the JSX the setup returns, with modifiers after it", () => {
      const { lp, fn } = hello(
        `  const on = signal(false);\n  return (<Text>hi</Text>).padding(4);`,
      );
      const body = bodyOf(fn, "swiftui");

      expect(body.getText()).toBe("(<Text>hi</Text>).padding(4)");
      expect(jsxRoot(body)?.getText()).toBe("<Text>hi</Text>");
      // The setup's code is the program's; the body's is SwiftUI's.
      expect(isToolkitBody(lp.checker, fn)).toBe(false);
    });

    it.skipIf(!ios)("is returned once, as the setup's last statement", () => {
      const { fn } = hello(
        `  const on = signal(false);\n  if (on.peek()) return <Text>on</Text>;\n  return <Text>off</Text>;`,
      );

      expect(() => bodyOf(fn, "swiftui")).toThrow(
        "a SwiftUI component returns its body once, as the last statement of its setup: the body is one view, and its conditions are written in it (`{shown && <Text>…</Text>}`)",
      );
    });

    it.skipIf(!ios)("is JSX", () => {
      const { fn } = hello(`  return 1;`);

      expect(() => bodyOf(fn, "swiftui")).toThrow(
        "a SwiftUI component returns its body: JSX of SwiftUI's views, which the setup's last statement returns",
      );
    });

    it.skipIf(!ios)("keeps its callbacks out of the program's code", () => {
      const { lp, fn } = hello(
        `  const tap = () => {};\n  return <Text onTapGesture={() => tap()}>hi</Text>;`,
      );
      let callback: ts.Node | undefined;
      const visit = (n: ts.Node): void => {
        if (ts.isArrowFunction(n) && ts.isJsxExpression(n.parent)) callback = n;
        ts.forEachChild(n, visit);
      };

      visit(fn);
      expect(isToolkitBody(lp.checker, callback!)).toBe(true);
    });
  });
});
