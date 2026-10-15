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
    expect(dts).toMatch(
      /\ndeclare abstract class NSObject_Kit \{[^]*?get kitLabel\(\): string \| null;/,
    );
    expect(dts).toMatch(
      /declare module "lucent:ios" \{\s+interface NSObject extends NSObject_Kit \{\}\s+\}/,
    );
    expect(dts).not.toMatch(/export declare (abstract )?class NSObject/);
  });
});

/**
 * A category on another module's class (UIKit's `NSIndexPath
 * (UIKitAdditions)`, whose `row` and `section` table views use): the class
 * of Kit's own extends Foundation's, so an index path from anywhere has them.
 */
const FOUNDATION = {
  module: "Foundation",
  header: "Foundation/Foundation.h",
  types: [
    {
      kind: "class",
      name: "NSIndexPath",
      native: "NSIndexPath",
      constructors: [{ params: [], selector: "init" }],
      properties: [{ name: "length", type: "int", readonly: true }],
    },
  ],
};

const TABLES = {
  module: "Tables",
  header: "Tables/Tables.h",
  types: [
    {
      kind: "class",
      name: "TBLView",
      native: "TBLView",
      constructors: [{ params: [], selector: "init" }],
      methods: [
        {
          name: "selectedPath",
          params: [],
          returns: "Foundation.NSIndexPath",
          selector: "selectedPath",
        },
      ],
    },
    {
      kind: "class",
      name: "NSIndexPath_Tables",
      native: "NSIndexPath",
      extensionOf: "Foundation.NSIndexPath",
      properties: [
        { name: "row", type: "int", readonly: true },
        { name: "section", type: "int", readonly: true },
      ],
      methods: [
        {
          name: "indexPathForRowInSection",
          static: true,
          params: [
            { name: "row", type: "int" },
            { name: "section", type: "int" },
          ],
          returns: "Foundation.NSIndexPath",
          selector: "indexPathForRow:inSection:",
        },
      ],
    },
  ],
};

describe("members a module adds to another module's class", () => {
  it("are every object's of that class, sent to it as one", () => {
    const p = setProgram(
      `import { NSIndexPath } from "lucent:ios/Foundation";
import { TBLView } from "lucent:ios/Tables";
function describe(path: NSIndexPath): string {
  return \`\${path.section}:\${path.row} of \${path.length}\`;
}
export async function run(): Promise<string> {
  return describe(new TBLView().selectedPath());
}
`,
      schemaSet([FOUNDATION, TABLES]),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toMatch(/\[\(+NSIndexPath\s*\*\)[^\]]*section\]/);
    expect(p.mm).toMatch(/\[\(+NSIndexPath\s*\*\)[^\]]*row\]/);
    expect(p.mm).toContain("Tables/Tables.h");
    const dts = [...p.types.values()].join("\n");
    expect(dts).toMatch(
      /declare module "lucent:ios\/Foundation" \{\s+interface NSIndexPath extends NSIndexPath_Tables \{\}/,
    );
  });

  it("take its class methods, sent to that class", () => {
    const p = setProgram(
      `import { NSIndexPath } from "lucent:ios/Foundation";
import "lucent:ios/Tables";
export async function run(): Promise<string> {
  const path = NSIndexPath.indexPathForRowInSection(2, 1);
  return \`\${path.section}:\${path.row}\`;
}
`,
      schemaSet([FOUNDATION, TABLES]),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toMatch(/\[NSIndexPath indexPathForRow:[^\]]*inSection:/);
    const dts = [...p.types.values()].join("\n");
    expect(dts).toMatch(
      /namespace NSIndexPath \{\s+const indexPathForRowInSection: typeof NSIndexPath_Tables\.indexPathForRowInSection;/,
    );
  });
});
