/**
 * Members a module adds to another module's class (T112): an Objective-C
 * category on NSObject, as UIKit's `NSObject (UIAccessibility)` adds
 * `accessibilityLabel`. bindgen gives the module a class of its own for
 * them (`NSObject_Kit`, `extensionOf`), which lucent:ios's NSObject
 * extends, so every object has them, and a use sends the message to the
 * object as an NSObject, with the module's header imported.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const KIT = {
  module: "Kit",
  header: "Kit/Kit.h",
  types: [
    {
      kind: "class",
      name: "KITView",
      native: "KITView",
      constructors: [{ params: [], selector: "init" }],
      properties: [{ name: "kitIdentifier", type: "string?", setter: "setKitIdentifier:" }],
    },
    {
      kind: "class",
      name: "NSObject_Kit",
      native: "NSObject",
      extensionOf: "ObjectiveC.NSObject",
      properties: [
        { name: "kitLabel", type: "string?", setter: "setKitLabel:" },
        {
          name: "isKitElement",
          type: "bool",
          selector: "isKitElement",
          setter: "setIsKitElement:",
        },
      ],
      methods: [{ name: "kitActivate", params: [], returns: "bool", selector: "kitActivate" }],
    },
  ],
};

describe("members a module adds to NSObject", () => {
  it("are every object's, sent to it as an NSObject", () => {
    const p = setProgram(
      `import { KITView } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  const view = new KITView();
  view.kitLabel = "a label";
  return \`\${view.kitLabel} \${view.isKitElement} \${view.kitActivate()}\`;
}
`,
      schemaSet([KIT]),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toMatch(/\[\(+NSObject\s*\*\)[^\]]*setKitLabel:/);
    expect(p.mm).toMatch(/\[\(+NSObject\s*\*\)[^\]]*kitLabel\]/);
    expect(p.mm).toMatch(/isKitElement\]/);
    expect(p.mm).toMatch(/kitActivate\]/);
    expect(p.mm).toContain("Kit/Kit.h");
  });

  it("are a class of the module's own, which lucent:ios's NSObject extends", () => {
    const p = setProgram(
      `import { KITView } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  return \`\${new KITView().kitIdentifier}\`;
}
`,
      schemaSet([KIT]),
    );

    expect(p.messages).toEqual([]);
    const dts = p.types.get("ios/Kit.d.ts") ?? [...p.types.values()].join("\n");
    expect(dts).toMatch(/\ndeclare abstract class NSObject_Kit \{[^]*?kitLabel: string \| null;/);
    expect(dts).toMatch(
      /declare module "lucent:ios" \{\s+interface NSObject extends NSObject_Kit \{\}\s+\}/,
    );
    expect(dts).not.toMatch(/export declare (abstract )?class NSObject/);
  });
});
