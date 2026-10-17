/**
 * A Lucent class overriding its iOS base's properties with accessors
 * (T112), as a view overrides `intrinsicContentSize` or a controller
 * `preferredStatusBarStyle`: its Objective-C subclass's getter and setter
 * forward to them, and `super.name` reads and writes the base's. An iOS
 * class declares its properties as accessors, which TypeScript lets a
 * subclass's accessors override. Compiled against a schema set, on any
 * machine.
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
      properties: [
        { name: "title", type: "string?", setter: "setTitle:" },
        { name: "contentWidth", type: "double", readonly: true },
        { name: "isActive", type: "bool", selector: "isActive", readonly: true },
      ],
      methods: [{ name: "layout", params: [], returns: "void", selector: "layout" }],
    },
  ],
};

const program = (body: string) =>
  setProgram(
    `import { KITView } from "lucent:ios/Kit";

class Badge extends KITView {
${body}
}

export async function run(): Promise<string> {
  const badge = new Badge();
  return \`\${badge.contentWidth}\`;
}
`,
    schemaSet([KIT]),
  );

describe("a Lucent class overriding its iOS base's properties", () => {
  it("is the getter and setter the platform calls, with super the base's", () => {
    const p = program(`  get contentWidth(): number {
    return super.contentWidth + 8;
  }

  get isActive(): boolean {
    return true;
  }

  get title(): string | null {
    return super.title;
  }

  set title(value: string | null) {
    super.title = value === null ? null : value.toUpperCase();
  }`);

    expect(p.messages).toEqual([]);
    // The overrides forward to the accessors, while the platform waits.
    expect(p.mm).toMatch(/- \(double\)contentWidth \{[^]*?get_contentWidth\(\)/);
    expect(p.mm).toMatch(/- \(BOOL\)isActive \{[^]*?get_isActive\(\)/);
    expect(p.mm).toMatch(/- \(NSString\s*\*\)title \{[^]*?get_title\(\)/);
    expect(p.mm).toMatch(/- \(void\)setTitle:\(NSString\s*\*\)a0_ \{[^]*?set_title\(/);
    // The base's, for super and for calls before the constructor is done.
    expect(p.mm).toMatch(
      /- \(double\)lucentSuper_contentWidth \{\s*return \[super contentWidth\];/,
    );
    expect(p.mm).toMatch(
      /- \(void\)lucentSuper_setTitle:\(NSString\s*\*\)a0_ \{\s*\[super setTitle:a0_\];/,
    );
    // super.name: the base's getter and setter, not the override.
    expect(p.mm).toMatch(/\[\(+LucentSub_Badge\s*\*\)[^\]]*lucentSuper_contentWidth\]/);
    expect(p.mm).toMatch(/\[\(+LucentSub_Badge\s*\*\)[^\]]*lucentSuper_title\]/);
    expect(p.mm).toMatch(/\[\(+LucentSub_Badge\s*\*\)[^\]]*lucentSuper_setTitle:/);
    const dts = [...p.types.values()].join("\n");
    expect(dts).toContain("get contentWidth(): number;");
    expect(dts).not.toContain("set contentWidth(");
    expect(dts).toContain("set title(value: string | null);");
  });

  it("refuses a setter for a read-only property, and a field of a property's name", () => {
    const setter = program(`  set contentWidth(value: number) {}
  get contentWidth(): number {
    return 1;
  }`);
    expect(setter.messages.map((m) => m[1])).toContainEqual(
      expect.stringContaining(
        "Badge.contentWidth: KITView.contentWidth is read-only: it has no setter to override",
      ),
    );

    // TypeScript refuses a field over an accessor; Lucent says why, and the way around it.
    const field = program("  title: string | null = null;");
    expect(field.r.diagnostics.map((d) => [d.code, d.message, d.fix])).toEqual([
      [
        "LUCENT9001",
        "TS2610: 'title' is defined as an accessor in class 'KITView', but is overridden here in 'Badge' as an instance property. title is KITView's Objective-C property: a field would hide it from KITView.",
        "set it (this.title = …) instead of declaring a field, or override it with get and set accessors",
      ],
    ]);
  });
});
