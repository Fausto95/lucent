// The JSX a platform's Lucent files write is its
// toolkit's: the program resolves each file's implicit JSX runtime import
// to its platform's toolkit module, whose JSX namespace types it. A shared
// file writes no toolkit's JSX. A component returning a toolkit's JSX is
// that toolkit's: its root is the toolkit's root class.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "../../src/index.ts";
import { builtinSdkModuleOf, createLucentProgram, jsxRuntimeOf } from "../../src/program.ts";
import { elementsOf, returnShape, sdkRoot } from "../../src/ui/roots.ts";
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
  it("resolves each platform file's JSX runtime to its toolkit", () => {
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/toggle.ios.lucent.tsx")).toBe(
      "lucent:swiftui",
    );
    expect(jsxRuntimeOf("lucent:jsx/jsx-dev-runtime", "/a/toggle.android.lucent.tsx")).toBe(
      "lucent:compose",
    );
    // A shared file writes either platform's toolkit, each in its platform's code.
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/toggle.lucent.tsx")).toBe("lucent:jsx");
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
    // An element is SwiftUI's View, and (T48) UIKit's UIView: a component returns either.
    const element = lp.checker.getTypeAtLocation(firstJsx(sf));
    const [view, ...others] = elementsOf(element) ?? [];
    const decl = view?.getSymbol()?.declarations?.[0];

    expect(view && lp.checker.typeToString(view)).toBe("View");
    expect(others).toEqual([]);
    expect(decl && builtinSdkModuleOf(decl.getSourceFile())).toBe("lucent:swiftui");
    expect(lp.diagnostics.map((d) => d.message).filter((m) => /TS(2875|7026)/.test(m))).toEqual([]);
  });

  it.skipIf(!ios || !sdkAvailable("android"))(
    "types a shared file's JSX with both toolkits",
    () => {
      const lp = program({
        "a.lucent.tsx": `import { PLATFORM } from "lucent:platform";\nimport { Text } from "lucent:swiftui";\nexport const hello = PLATFORM === "ios" ? <Text>hi</Text> : null;\n`,
      });
      const element = lp.checker.getTypeAtLocation(firstJsx(lp.modules[0]!.sourceFile));

      // Both toolkits' views at once, and both platforms' root views (T48).
      expect(elementsOf(element)?.map((t) => lp.checker.typeToString(t))).toEqual([
        "View",
        "Composed",
      ]);
      expect(
        element.isIntersection() && element.types.map((t) => lp.checker.typeToString(t)),
      ).toEqual(["View", "Composed", "UIView", "View"]);
      expect(lp.diagnostics).toEqual([]);
    },
  );

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
      const body = bodyOf(fn, "swiftui", lp.checker);

      expect(body.getText()).toBe("(<Text>hi</Text>).padding(4)");
      expect(jsxRoot(body)?.getText()).toBe("<Text>hi</Text>");
      // The setup's code is the program's; the body's is SwiftUI's.
      expect(isToolkitBody(lp.checker, fn)).toBe(false);
    });

    it.skipIf(!ios)("is returned once, as the setup's last statement", () => {
      const { lp, fn } = hello(
        `  const on = signal(false);\n  if (on.peek()) return <Text>on</Text>;\n  return <Text>off</Text>;`,
      );

      expect(() => bodyOf(fn, "swiftui", lp.checker)).toThrow(
        "a SwiftUI component returns its body once, as the last statement of its setup: the body is one view, and its conditions are written in it (`{shown && <Text>…</Text>}`)",
      );
    });

    it.skipIf(!ios)("is JSX", () => {
      const { lp, fn } = hello(`  return 1;`);

      expect(() => bodyOf(fn, "swiftui", lp.checker)).toThrow(
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
