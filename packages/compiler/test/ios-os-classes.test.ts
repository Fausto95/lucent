/**
 * iOS classes the OS makes (decision 0124): an exported class extending an
 * iOS class has an Objective-C class named `LucentApp_<module>_<Class>`,
 * which an extension's `NSExtensionPrincipalClass` names. When its
 * constructor and super(…) take nothing, its `init` makes the Lucent
 * instance through the native root, and super(…) adopts the object the OS
 * made. Compiled against a schema set, on any machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { osObjcName } from "../src/os-names.ts";
import { schemaSet, setProgram } from "./schema-set.ts";

const KIT = {
  module: "Kit",
  header: "Kit/Kit.h",
  types: [
    {
      kind: "class",
      name: "KITService",
      native: "KITService",
      constructors: [
        { params: [], selector: "init" },
        { params: [{ name: "name", type: "string" }], selector: "initWithName:" },
      ],
      methods: [
        {
          name: "didReceive",
          params: [{ name: "text", type: "string" }],
          returns: "void",
          selector: "didReceive:",
        },
      ],
    },
  ],
};

const set = schemaSet([KIT]);

const program = (body: string) =>
  setProgram(
    `import { KITService } from "lucent:ios/Kit";

${body}

export async function run(): Promise<string> {
  return "";
}
`,
    set,
  );

describe("an exported class extending an iOS class", () => {
  it("is an Objective-C class the OS makes by name, whose init makes its Lucent instance", () => {
    const p = program(`let received = 0;

export class Rich extends KITService {
  didReceive(text: string): void {
    received += text.length;
  }
}`);

    expect(p.messages).toEqual([]);
    expect(osObjcName("lucent-push/push/rich", "Rich")).toBe(
      "LucentApp_lucent_push_push_rich_Rich",
    );
    expect(p.mm).toContain("@interface LucentApp_m_Rich : KITService");
    expect(p.mm).not.toContain("LucentSub_Rich");
    // The OS's init: the Lucent instance, through the native root.
    expect(p.mm).toMatch(
      /- \(instancetype\)init \{\s*self = \[super init\];\s*if \(self && lucent::objc::madeByOs\(\) && !lucent_app::os_C_Rich\(self\)\) \{?\s*return nil;\s*\}?\s*return self;/,
    );
    expect(p.mm).toMatch(
      /static bool os_C_Rich\(id self_\) \{\s*lucent::ensureModuleState\(&lucent_app::initModules\);\s*auto hold_ = std::make_shared<lucent::ModuleStateHold>\(\);\s*lucent::entries::detail::EntryScope scope_\(.*\);\s*return lucent::objc::adoptOsObject\(self_, \[LucentApp_m_Rich class\], hold_, \[&\]\(\) \{[^}]*lucent_app::C_Rich::create\(\)[^}]*\}, "Rich"\);/,
    );
    // Its super(…), implicit here: the object the OS made, or a new one.
    expect(p.mm).toMatch(
      /lucent::objc::superObject\(\[LucentApp_m_Rich class\], \[&\]\(\) -> id \{\s*(#line \d+\s*)?return \[\[LucentApp_m_Rich alloc\] init\];/,
    );
    // The factory is declared before the implementation that calls it.
    expect(p.mm.indexOf("os_C_Rich(id self_)")).toBeLessThan(
      p.mm.indexOf("@implementation LucentApp_m_Rich"),
    );
  });

  it("needs no declaration in the shared file, since JavaScript never sees it", () => {
    const p = program("export class Rich extends KITService {}");

    expect(p.messages).toEqual([]);
    expect([...p.types.values()].join("\n")).not.toContain("Rich");
  });

  it("has no OS init when its constructor or super(…) takes something", () => {
    const params = program(`export class Named extends KITService {
  constructor(name: string) {
    super(name);
  }
}`);
    expect(params.messages).toEqual([]);
    expect(params.mm).toContain("@interface LucentApp_m_Named : KITService");
    expect(params.mm).not.toContain("- (instancetype)init");
    expect(params.mm).not.toContain("superObject");

    const fixed = program(`export class Fixed extends KITService {
  constructor() {
    super("fixed");
  }
}`);
    expect(fixed.messages).toEqual([]);
    expect(fixed.mm).not.toContain("- (instancetype)init");
  });

  it("keeps a build's name for a class that isn't exported", () => {
    const p = setProgram(
      `import { KITService } from "lucent:ios/Kit";

class Local extends KITService {}

export async function run(): Promise<string> {
  new Local();
  return "";
}
`,
      set,
    );

    expect(p.messages).toEqual([]);

    expect(p.mm).toContain("@interface LucentSub_Local : KITService");
    expect(p.mm).not.toContain("LucentApp_");
  });

  it("gives two classes whose names come out the same none the OS can rely on, with a warning", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-os-names-"));
    const files: Record<string, string> = {};
    for (const m of ["a-b", "a_b"]) {
      files[`${m}.lucent.ts`] = "export declare function f(): void;\n";
      files[`${m}.ios.lucent.ts`] =
        'import { KITService } from "lucent:ios/Kit";\n\nexport class S extends KITService {}\n\nexport function f(): void {}\n';
      files[`${m}.android.lucent.ts`] = "export function f(): void {}\n";
    }
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

    const r = compile(
      Object.keys(files).map((f) => path.join(dir, f)),
      {
        platforms: ["ios"],
        sdk: {
          schemas: set,
          cacheDir: path.join(dir, "cache"),
          ios: { xcrun: path.join(dir, "no-xcrun") },
        },
      },
    );

    expect(r.diagnostics).toEqual([]);
    expect((r.warnings ?? []).map((d) => `${d.code} ${d.message}`)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3016 a-b\.S and a_b\.S would have the same Objective-C class, LucentApp_a_b_S: the OS can make neither by name$/,
      ),
    );
    const units = [...r.files].filter(([f]) => f.endsWith(".mm")).map(([, text]) => text);
    expect(units.join("\n")).not.toContain("LucentApp_a_b_S");
    expect(units.join("\n")).toContain("@interface LucentSub_S : KITService");
  });
});
