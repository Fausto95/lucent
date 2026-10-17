// The no-catalog audit (T152): every platform name Lucent's code says is a
// fixed platform anchor of docs/design/contracts.md, and every anchor is
// said where its row places it.
import { describe, expect, it } from "vite-plus/test";
import { type Anchor, anchors, audit, namesIn, platformNames } from "./platform-names.ts";

const names = (text: string, file: string) => [...namesIn(text, file).keys()].sort();

describe("the platform names Lucent's code says", () => {
  it("are found in code and strings, not in comments, imports or Lucent's own names", () => {
    expect(
      names(
        `import { useState } from "react";
import type { UIView } from "lucent:ios/UIKit";
// UIWindow, as a comment names it.
/** NSBundle, in a doc comment. */
const root: UIView = make("android/view/View", "Landroidx/annotation/NonNull;", "kotlin/Unit");
const own = ["dev.lucent.LucentPackage", "LucentNative", "android.resources"];
const app = require.resolve("react-native/package.json");
`,
        "packages/compiler/src/sample.ts",
      ),
    ).toEqual([
      "apple:UIView",
      "jvm:android.view.View",
      "jvm:androidx.annotation.NonNull",
      "jvm:kotlin.Unit",
      "npm:react-native",
    ]);

    expect(
      names(
        `// UIApplication isn't said here.
#import <UIKit/UIKit.h>
void f(facebook::jsi::Runtime& rt) {
  jclass c = env->FindClass("java/lang/String"); /* CGRect neither */
  NSLog(@"%@", [NSString new]);
}
`,
        "packages/runtime/cpp/lucent/sample.mm",
      ),
    ).toEqual([
      "apple:NSLog",
      "apple:NSString",
      "apple:UIKit",
      "framework:UIKit",
      "jvm:java.lang.String",
      "react-native:facebook::jsi::Runtime",
    ]);

    // A file's path is no class: `android/CMakeLists.txt`, `ios/Pods/Foo.xcframework`.
    expect(names('const f = ["android/src/main/AndroidManifest.xml"];\n', "packages/x.ts")).toEqual(
      [],
    );
  });

  it("are each a fixed platform anchor, and each anchor is said where its row says", () => {
    const { uncovered, stale } = audit(platformNames(), anchors());

    expect(uncovered).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe("the audit", () => {
  const found = namesIn(
    'const v = "android/view/View";\nconst l = "android/widget/ListView";\n',
    "packages/compiler/src/ui/roots.ts",
  );
  const row = (names: string[], where: string[], kind = "platform"): Anchor => ({
    names,
    where,
    kind,
    line: 1,
  });

  it("fails on a name no row covers, and a name said outside its row's files", () => {
    expect(audit(found, [row(["android.view.View"], ["compiler/src/ui/roots.ts"])])).toEqual({
      uncovered: ["android.widget.ListView in compiler/src/ui/roots.ts"],
      stale: [],
    });
    expect(audit(found, [row(["android.*"], ["compiler/src/emit/*.ts"])]).uncovered).toEqual([
      "android.view.View in compiler/src/ui/roots.ts",
      "android.widget.ListView in compiler/src/ui/roots.ts",
    ]);
  });

  it("fails on a row's name or file that covers nothing, and on an unknown kind", () => {
    expect(
      audit(found, [
        row(
          ["android.view.View", "android.widget.*", "UIView"],
          ["compiler/src/ui/{roots,views}.ts"],
        ),
        row(["android.view.*"], ["compiler/src/**", "runtime/**"], "catalog"),
      ]).stale,
    ).toEqual([
      "docs/design/contracts.md:1: `UIView` is said in none of its places",
      'docs/design/contracts.md:1: kind "catalog" is none of language, ABI, platform, example',
      "docs/design/contracts.md:1: `runtime/**` says none of its names",
    ]);
  });

  it("reads the contracts' table: each row's names and places in backticks", () => {
    const rows = anchors(`# Contracts

## Fixed platform anchors

| Names | Where | Kind | Why |
| --- | --- | --- | --- |
| \`UIView\`, \`android.view.View\` | \`compiler/src/ui/roots.ts\` | platform | The class a host mounts. |

## C-BIND
`);
    expect(rows).toEqual([
      {
        names: ["UIView", "android.view.View"],
        where: ["compiler/src/ui/roots.ts"],
        kind: "platform",
        line: 7,
      },
    ]);
  });
});
