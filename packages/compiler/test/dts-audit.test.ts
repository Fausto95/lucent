import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkAvailable, sdkSourceModule } from "@lucent-lang/bindgen";
import { describe, expect, it } from "vite-plus/test";
import { sdkDts } from "../src/sdk/dts.ts";
import { toolkitDts } from "../src/sdk/toolkit-dts.ts";
import { TOOLKITS } from "../src/ui/toolkits.ts";
import { parseSdkType, type Platform, type SdkModuleSchema } from "../src/sdk/schema.ts";
import {
  type Audit,
  auditSdk,
  auditTexts,
  byCategory,
  type Category,
  tally,
  UIKIT,
} from "./dts-audit.ts";

/**
 * Generated SDK declarations checked without skipLibCheck. Apps never check
 * them (their tsconfig skips library checks), so invalid declarations would
 * otherwise go unnoticed.
 *
 * The real-SDK part compares against dts-audit.baseline.json, error by
 * error: a new error fails, and so does a fixed one until the baseline is
 * rewritten (`LUCENT_UPDATE_DTS_AUDIT=1`), so the counts stay exact. The
 * modules audited are a sample of large SDK surfaces, not a list of what
 * Lucent binds.
 *
 * The fixtures reproduce each category of error on a minimal schema. They
 * assert today's wrong output: fixing a category flips its fixture.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(here, "dts-audit.baseline.json");

type Baseline = Record<Platform, { modules: string[]; errors: Record<string, number> }>;

/** A schema with types in their written form, as sdk-types.test.ts writes them. */
function typed(
  schema: { platform: Platform; module: string } & Record<string, unknown>,
): SdkModuleSchema {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;

    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        (k === "type" || k === "returns") && typeof x === "string"
          ? parseSdkType(x, schema.module)
          : walk(x),
      ]),
    );
  };

  return walk({ types: [], ...schema }) as SdkModuleSchema;
}

/** java.lang's Object, which every Android class extends: a fixture module without it declares it. */
const javaLang = () =>
  typed({
    platform: "android",
    module: "java.lang",
    types: [
      {
        kind: "class",
        name: "Object",
        native: "java/lang/Object",
        constructors: [{ params: [] }],
      },
    ],
  });

function audit(...schemas: SdkModuleSchema[]): Audit {
  const lang =
    schemas.some((s) => s.platform === "android") && !schemas.some((s) => s.module === "java.lang")
      ? [javaLang()]
      : [];

  return auditTexts(
    Object.fromEntries([...schemas, ...lang].map((s) => [`${s.platform}/${s.module}`, sdkDts(s)])),
  );
}

/** The categories and codes of an audit's errors: `protocol-merging TS2320`. */
function kinds(a: Audit): string[] {
  return [...new Set(a.errors.map((e) => `${e.category} TS${e.code}`))].sort();
}

describe("declaration audit fixtures", () => {
  it("accepts a well-formed module", () => {
    const a = audit(
      typed({
        platform: "android",
        module: "com.example.ok",
        types: [
          {
            kind: "class",
            name: "Widget",
            native: "com/example/ok/Widget",
            constructors: [{ params: [] }],
            methods: [{ name: "size", params: [], returns: "int" }],
          },
        ],
      }),
    );

    // The module, and java.lang (its classes extend Object).
    expect(a.files).toBe(2);
    expect(a.errors).toEqual([]);
  });

  it("accepts a subclass overriding one of its superclass's overloads", () => {
    const a = audit(
      typed({
        platform: "android",
        module: "com.example.v",
        types: [
          {
            kind: "class",
            name: "Base",
            native: "com/example/v/Base",
            methods: [
              { name: "limit", params: [], returns: "int" },
              { name: "limit", params: [{ name: "arg0", type: "int" }], returns: "Base?" },
            ],
          },
          {
            kind: "class",
            name: "Sub",
            native: "com/example/v/Sub",
            extends: "Base",
            methods: [{ name: "limit", params: [{ name: "arg0", type: "int" }], returns: "Sub" }],
          },
        ],
      }),
    );

    expect(a.errors).toEqual([]);
  });

  it("leaves out a promise form named like a property: its method stays", () => {
    const schema = typed({
      platform: "ios",
      module: "Fixture",
      types: [
        {
          kind: "class",
          name: "FXStore",
          native: "FXStore",
          properties: [{ name: "items", type: "string[]", readonly: true }],
          methods: [
            {
              name: "getItems",
              selector: "getItemsWithCompletionHandler:",
              params: [{ name: "completionHandler", type: "@escaping (string[]) => void" }],
              returns: "void",
              async: { returns: "string[]", name: "items" },
            },
          ],
        },
      ],
    });

    const a = audit(schema);

    expect(a.errors).toEqual([]);
    expect(sdkDts(schema)).toContain("getItems(");
  });

  it("keeps a protocol's overloads beside a class method of the same name", () => {
    const schema = typed({
      platform: "ios",
      module: "Fixture",
      types: [
        {
          kind: "class",
          name: "FXLocking",
          native: "FXLocking",
          interface: true,
          methods: [{ name: "lock", selector: "lock", params: [], returns: "void" }],
        },
        {
          kind: "class",
          name: "FXLock",
          native: "FXLock",
          implements: ["FXLocking"],
          methods: [
            {
              name: "lock",
              selector: "lockBeforeDate:",
              params: [{ name: "limit", type: "NSDate" }],
              returns: "bool",
            },
          ],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
  });

  it("declares again what a superclass and an inherited interface declare differently", () => {
    const addAll = (nullable: boolean, abstract: boolean) => ({
      name: "addAll",
      params: [{ name: "arg0", type: nullable ? "Collection?" : "Collection" }],
      returns: "boolean",
      descriptor: "(Ljava/util/Collection;)Z",
      ...(abstract ? { abstract: true } : {}),
    });
    const schema = typed({
      platform: "android",
      module: "java.util",
      types: [
        {
          kind: "class",
          name: "Collection",
          native: "java/util/Collection",
          interface: true,
          methods: [addAll(true, true)],
        },
        // Declares no addAll itself: Collection's comes through it.
        {
          kind: "class",
          name: "Queue",
          native: "java/util/Queue",
          interface: true,
          implements: ["Collection"],
        },
        // Adopted by ArrayQueue, not by its superclass.
        {
          kind: "class",
          name: "BlockingQueue",
          native: "java/util/BlockingQueue",
          interface: true,
          implements: ["Queue"],
        },
        {
          kind: "class",
          name: "AbstractQueue",
          native: "java/util/AbstractQueue",
          abstract: true,
          implements: ["Queue"],
          methods: [addAll(false, false)],
        },
        {
          kind: "class",
          name: "ArrayQueue",
          native: "java/util/ArrayQueue",
          extends: "AbstractQueue",
          implements: ["BlockingQueue"],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);

    // The superclass's method, which implements the interface's in Java.
    expect(sdkDts(schema)).toMatch(
      /class ArrayQueue extends AbstractQueue \{[^}]*@lucentInherited java\.util\.AbstractQueue 0[^}]*addAll\(arg0: Collection\): boolean;/,
    );
  });

  it("names repeated parameters and shadowed type parameters apart", () => {
    const schema = typed({
      platform: "ios",
      module: "Fixture",
      types: [
        {
          kind: "class",
          name: "FXHandlers",
          native: "FXHandlers",
          swift: { kind: "class" },
          typeParams: ["Section", "Item", "Item"],
          methods: [
            {
              name: "image",
              params: [
                { name: "state", type: "int" },
                { name: "state", type: "int" },
              ],
              returns: "void",
              swift: { name: "image(for:state:)" },
            },
          ],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
  });

  it("leaves out an interface another listed interface already extends", () => {
    const schema = typed({
      platform: "android",
      module: "com.example.t",
      types: [
        {
          kind: "class",
          name: "Temporal",
          native: "com/example/t/Temporal",
          interface: true,
          methods: [
            {
              name: "isSupported",
              params: [{ name: "arg0", type: "int" }],
              returns: "boolean",
              abstract: true,
            },
          ],
        },
        {
          kind: "class",
          name: "ChronoDate",
          native: "com/example/t/ChronoDate",
          interface: true,
          implements: ["Temporal"],
          methods: [
            {
              name: "isSupported",
              params: [{ name: "arg0", type: "int" }],
              returns: "boolean",
              abstract: true,
            },
            {
              name: "isSupported",
              params: [{ name: "arg0", type: "string" }],
              returns: "boolean",
              abstract: true,
            },
          ],
        },
        {
          kind: "class",
          name: "LunarDate",
          native: "com/example/t/LunarDate",
          implements: ["ChronoDate", "Temporal"],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
    expect(sdkDts(schema)).toContain("interface LunarDate extends ChronoDate {}");
  });

  it("declares a property a superclass and a protocol declare differently, as the superclass does", () => {
    const a = audit(
      typed({
        platform: "ios",
        module: "Fixture",
        types: [
          {
            kind: "class",
            name: "FXBase",
            native: "FXBase",
            properties: [{ name: "bounds", type: "string" }],
          },
          {
            kind: "class",
            name: "FXItem",
            native: "FXItem",
            interface: true,
            properties: [{ name: "bounds", type: "string?", readonly: true }],
          },
          {
            kind: "class",
            name: "FXView",
            native: "FXView",
            extends: "FXBase",
            implements: ["FXItem"],
          },
        ],
      }),
    );

    expect(kinds(a)).toEqual([]);
  });

  it("reproduces an incompatible override: a subclass method returning another type", () => {
    const a = audit(
      typed({
        platform: "android",
        module: "com.example.o",
        types: [
          {
            kind: "class",
            name: "Base",
            native: "com/example/o/Base",
            methods: [{ name: "value", params: [], returns: "string?" }],
          },
          {
            kind: "class",
            name: "Sub",
            native: "com/example/o/Sub",
            extends: "Base",
            methods: [{ name: "value", params: [], returns: "int" }],
          },
        ],
      }),
    );

    expect(kinds(a)).toEqual(["override-incompatible TS2416"]);
  });

  it("reproduces a name collision: a base property that a subclass declares as a method", () => {
    const a = audit(
      typed({
        platform: "android",
        module: "com.example.n",
        types: [
          {
            kind: "class",
            name: "Base",
            native: "com/example/n/Base",
            properties: [{ name: "count", type: "int" }],
          },
          {
            kind: "class",
            name: "Sub",
            native: "com/example/n/Sub",
            extends: "Base",
            methods: [{ name: "count", params: [], returns: "int" }],
          },
        ],
      }),
    );

    expect(kinds(a)).toEqual(["name-collision TS2425", "override-incompatible TS2416"]);
  });

  it("imports a type named like a local one under its module's name", () => {
    const other = typed({
      platform: "android",
      module: "com.example.b",
      types: [{ kind: "class", name: "Item", native: "com/example/b/Item" }],
    });
    const local = typed({
      platform: "android",
      module: "com.example.a",
      types: [
        { kind: "class", name: "Item", native: "com/example/a/Item" },
        {
          kind: "class",
          name: "Holder",
          native: "com/example/a/Holder",
          methods: [
            { name: "other", params: [], returns: "com.example.b.Item?" },
            { name: "own", params: [], returns: "Item" },
          ],
        },
      ],
    });

    const a = audit(local, other);

    expect(a.errors).toEqual([]);
    const dts = sdkDts(local);
    expect(dts).toContain(
      'import type { Item as com_example_b_Item } from "lucent:android/com.example.b";',
    );
    expect(dts).toContain("other(): com_example_b_Item | null;");
    expect(dts).toContain("own(): Item;");
  });

  it("imports types two modules name alike apart, and a superclass named like its subclass", () => {
    const math = typed({
      platform: "android",
      module: "java.math",
      types: [{ kind: "class", name: "BigDecimal", native: "java/math/BigDecimal" }],
    });
    const icu = typed({
      platform: "android",
      module: "android.icu.math",
      types: [{ kind: "class", name: "BigDecimal", native: "android/icu/math/BigDecimal" }],
    });
    const text = typed({
      platform: "android",
      module: "android.text",
      types: [{ kind: "class", name: "ClipboardManager", native: "android/text/ClipboardManager" }],
    });
    // Both BigDecimals, and a ClipboardManager extending android.text's.
    const user = typed({
      platform: "android",
      module: "android.content",
      types: [
        {
          kind: "class",
          name: "ClipboardManager",
          native: "android/content/ClipboardManager",
          extends: "android.text.ClipboardManager",
        },
        {
          kind: "class",
          name: "Format",
          native: "android/content/Format",
          methods: [
            {
              name: "parse",
              params: [{ name: "arg0", type: "java.math.BigDecimal" }],
              returns: "android.icu.math.BigDecimal",
            },
          ],
        },
      ],
    });

    expect(audit(user, math, icu, text).errors).toEqual([]);
  });

  it("makes a static member naming its class's type parameter generic over it", () => {
    const schema = typed({
      platform: "ios",
      module: "Fixture",
      types: [
        {
          kind: "class",
          name: "FXBox",
          native: "FXBox",
          typeParams: ["T"],
          methods: [
            {
              name: "empty",
              static: true,
              params: [],
              returns: parseSdkType("FXBox<T>", "Fixture", ["T"]),
            },
          ],
        },
      ],
    });

    const a = audit(schema);

    expect(a.errors).toEqual([]);
    expect(sdkDts(schema)).toContain("static empty<T>(): FXBox<T>;");
  });

  it("reproduces generic arity: type arguments on a class that has no type parameters", () => {
    const a = audit(
      typed({
        platform: "ios",
        module: "Fixture",
        types: [
          { kind: "class", name: "FXPlain", native: "FXPlain" },
          {
            kind: "class",
            name: "FXUser",
            native: "FXUser",
            properties: [{ name: "plain", type: "FXPlain<string>" }],
          },
        ],
      }),
    );

    expect(kinds(a)).toEqual(["generic-arity TS2315"]);
  });

  it("reproduces a missing type: a reference to a type its module does not declare", () => {
    const other = typed({
      platform: "ios",
      module: "FixtureBase",
      types: [{ kind: "class", name: "FXNumber", native: "FXNumber" }],
    });
    const user = typed({
      platform: "ios",
      module: "Fixture",
      types: [
        {
          kind: "class",
          name: "FXUser",
          native: "FXUser",
          properties: [{ name: "amount", type: "FixtureBase.Decimal" }],
        },
      ],
    });

    const a = audit(user, other);

    expect(kinds(a)).toEqual(["missing-type TS2305"]);
  });

  it("leaves CharSequence, which is a string in Lucent, out of a class's supertypes", () => {
    const a = audit(
      typed({
        platform: "android",
        module: "com.example.s",
        types: [
          {
            kind: "class",
            name: "Name",
            native: "com/example/s/Name",
            implements: ["CharSequence"],
          },
        ],
      }),
    );

    expect(a.errors).toEqual([]);
  });

  it("requires a default method a superinterface declares abstract", () => {
    const schema = typed({
      platform: "android",
      module: "java.util",
      types: [
        {
          kind: "class",
          name: "SequencedCollection",
          native: "java/util/SequencedCollection",
          interface: true,
          methods: [
            { name: "reversed", params: [], returns: "SequencedCollection?", abstract: true },
          ],
        },
        // Java gives it a body: implementers need not; TypeScript cannot make it optional here.
        {
          kind: "class",
          name: "Deque",
          native: "java/util/Deque",
          interface: true,
          implements: ["SequencedCollection"],
          methods: [
            { name: "reversed", params: [], returns: "Deque" },
            { name: "peek", params: [], returns: "int" },
          ],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
    const dts = sdkDts(schema);
    expect(dts).toContain("  reversed(): Deque;");
    // A default method no superinterface requires stays optional.
    expect(dts).toContain("  peek?(): number;");
  });

  it("makes every class extend java.lang.Object, so an Object result narrows to a class", () => {
    const lang = typed({
      platform: "android",
      module: "java.lang",
      types: [
        {
          kind: "class",
          name: "Object",
          native: "java/lang/Object",
          constructors: [{ params: [] }],
          methods: [{ name: "hashCode", params: [], returns: "int" }],
        },
      ],
    });
    const cert = typed({
      platform: "android",
      module: "java.security.cert",
      types: [
        {
          kind: "class",
          name: "Checker",
          native: "java/security/cert/Checker",
          methods: [{ name: "clone", params: [], returns: "java.lang.Object" }],
        },
        {
          kind: "class",
          name: "RevocationChecker",
          native: "java/security/cert/RevocationChecker",
          extends: "Checker",
          methods: [{ name: "clone", params: [], returns: "RevocationChecker" }],
        },
      ],
    });

    expect(audit(cert, lang).errors).toEqual([]);
    expect(sdkDts(cert)).toContain("export declare class Checker extends Object {");
    // Object itself extends nothing.
    expect(sdkDts(lang)).toContain("export declare class Object {");
  });

  it("declares again the Object overloads a class hides", () => {
    // In java.lang itself, so Object is this schema's, not the installed SDK's.
    const lang = typed({
      platform: "android",
      module: "java.lang",
      types: [
        {
          kind: "class",
          name: "Object",
          native: "java/lang/Object",
          constructors: [{ params: [] }],
          methods: [{ name: "notify", params: [], returns: "void" }],
        },
        {
          kind: "class",
          name: "Bell",
          native: "java/lang/Bell",
          methods: [{ name: "notify", params: [{ name: "arg0", type: "int" }], returns: "void" }],
        },
      ],
    });

    expect(audit(lang).errors).toEqual([]);
    expect(sdkDts(lang)).toContain("@lucentInherited java.lang.Object 0");
  });

  it("declares again the overloads a superclass's interface gives a method the class overrides", () => {
    const schema = typed({
      platform: "android",
      module: "java.time.chrono",
      types: [
        {
          kind: "class",
          name: "Chronology",
          native: "java/time/chrono/Chronology",
          interface: true,
          methods: [
            {
              name: "date",
              params: [{ name: "arg0", type: "int" }],
              returns: "int",
              abstract: true,
            },
            {
              name: "date",
              params: [{ name: "arg0", type: "string" }],
              returns: "int",
              abstract: true,
            },
          ],
        },
        {
          kind: "class",
          name: "AbstractChronology",
          native: "java/time/chrono/AbstractChronology",
          abstract: true,
          implements: ["Chronology"],
        },
        {
          kind: "class",
          name: "IsoChronology",
          native: "java/time/chrono/IsoChronology",
          extends: "AbstractChronology",
          methods: [{ name: "date", params: [{ name: "arg0", type: "int" }], returns: "int" }],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
  });

  it("declares a member two supertypes declare two ways through their own hierarchies", () => {
    const getChars = (abstract: boolean) => ({
      name: "getChars",
      params: [{ name: "arg0", type: "int" }],
      returns: "void",
      ...(abstract ? { abstract: true } : {}),
    });
    const schema = typed({
      platform: "android",
      module: "android.text",
      types: [
        {
          kind: "class",
          name: "Chars",
          native: "android/text/Chars",
          interface: true,
          methods: [getChars(false)],
        },
        {
          kind: "class",
          name: "GetChars",
          native: "android/text/GetChars",
          interface: true,
          implements: ["Chars"],
          methods: [getChars(true)],
        },
        {
          kind: "class",
          name: "Spannable",
          native: "android/text/Spannable",
          interface: true,
          implements: ["Chars"],
        },
        {
          kind: "class",
          name: "Editable",
          native: "android/text/Editable",
          interface: true,
          implements: ["GetChars", "Spannable"],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
  });

  it("declares a property its superclass and an interface give two ways, as the superclass does", () => {
    const layoutDirection = (oneOf?: string[]) => ({
      name: "layoutDirection",
      type: "int",
      readonly: true,
      getter: "getLayoutDirection",
      ...(oneOf ? { oneOf } : {}),
    });
    const schema = typed({
      platform: "android",
      module: "android.view",
      types: [
        {
          kind: "class",
          name: "View",
          native: "android/view/View",
          properties: [
            { name: "LTR", type: "int", static: true, readonly: true, value: 0 },
            layoutDirection(["android.view.View.LTR"]),
          ],
        },
        {
          kind: "class",
          name: "ViewParent",
          native: "android/view/ViewParent",
          interface: true,
          properties: [layoutDirection()],
        },
        {
          kind: "class",
          name: "ViewGroup",
          native: "android/view/ViewGroup",
          extends: "View",
          implements: ["ViewParent"],
        },
      ],
    });

    expect(audit(schema).errors).toEqual([]);
    // The class calls the superclass's getter: the tag names it.
    expect(sdkDts(schema)).toContain(
      "/** @lucentInherited android.view.View 1 */\n  readonly layoutDirection: typeof View.LTR;",
    );
  });
});

describe("declaration audit of lucent:swiftui", () => {
  // Generated from SwiftUI written as source: no error, rather than a baseline.
  it.skipIf(!sdkAvailable("ios"))(
    "has no errors",
    () => {
      const found = sdkSourceModule("ios", "SwiftUI");
      if ("missing" in found) throw new Error(found.missing);

      const a = auditTexts({
        "toolkit/swiftui": toolkitDts(TOOLKITS.swiftui, found.schema),
        "ios/UIKit": UIKIT,
      });

      expect(byCategory(a)).toEqual({});
    },
    600_000,
  );
});

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Baseline;
const update = process.env.LUCENT_UPDATE_DTS_AUDIT === "1";

describe.each(["ios", "android"] as const)("declaration audit of the %s SDK", (platform) => {
  it.skipIf(!sdkAvailable(platform))(
    "has exactly the baseline's errors",
    () => {
      const { modules } = baseline[platform];
      const a = auditSdk(platform, modules);
      const actual = tally(a);

      if (update) {
        baseline[platform].errors = actual;
        fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
      }

      const expected = baseline[platform].errors;
      const added = Object.keys(actual).filter((k) => actual[k] !== expected[k]);
      const removed = Object.keys(expected).filter((k) => !(k in actual));

      expect({ added, removed }, JSON.stringify(byCategory(a))).toEqual({ added: [], removed: [] });
      expect(a.files).toBeGreaterThan(modules.length);
    },
    600_000,
  );

  it("names a category for every baseline error", () => {
    const categories: Category[] = [
      "protocol-merging",
      "override-incompatible",
      "name-collision",
      "generic-statics",
      "generic-arity",
      "missing-type",
      "invalid-supertype",
    ];

    const unexplained = Object.keys(baseline[platform].errors).filter(
      (k) => !categories.includes(k.split("|")[2] as Category),
    );

    expect(unexplained).toEqual([]);
  });
});
