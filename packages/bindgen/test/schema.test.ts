import { describe, expect, it } from "vite-plus/test";
import {
  canonicalSchema,
  formatSchemaType,
  loadSchema,
  parseSchemaType,
  SCHEMA_FORMAT,
} from "../src/schema.ts";

describe("binding schema format", () => {
  it("loads a schema in the format this Lucent reads", () => {
    const schema = { format: SCHEMA_FORMAT, platform: "ios", module: "Widgets", types: [] };

    expect(SCHEMA_FORMAT).toBe(1);
    expect(loadSchema(schema)).toBe(schema);
  });

  it("refuses a schema of another format, or of none, naming its module", () => {
    expect(() => loadSchema({ format: 0, platform: "ios", module: "Widgets", types: [] })).toThrow(
      "Widgets: unsupported binding schema format 0; this Lucent reads format 1",
    );
    expect(() => loadSchema({ platform: "android", module: "android.os", types: [] })).toThrow(
      "android.os: unsupported binding schema format none; this Lucent reads format 1",
    );
    expect(() => loadSchema(null)).toThrow(
      "<unknown module>: unsupported binding schema format none; this Lucent reads format 1",
    );
  });
});

describe("canonical schemas", () => {
  const T = { k: "prim", name: "int", nullable: false } as const;

  it("orders types and members by name, then native symbol, whatever the extraction order", () => {
    const schema = canonicalSchema({
      format: SCHEMA_FORMAT,
      platform: "ios",
      module: "M",
      types: [
        {
          kind: "class",
          name: "Zed",
          native: "Zed",
          methods: [
            { name: "b", params: [], returns: T, symbol: "objc:2" },
            { name: "a", params: [], returns: T, symbol: "objc:9" },
            { name: "a", params: [], returns: T, symbol: "objc:1" },
          ],
          properties: [
            { name: "y", type: T },
            { name: "x", type: T },
          ],
        },
        {
          kind: "enum",
          name: "Alpha",
          native: "Alpha",
          cases: [
            { name: "z", native: "z", value: 0 },
            { name: "a", native: "a", value: 1 },
          ],
        },
      ],
      functions: [
        { name: "g", params: [], returns: T },
        { name: "f", params: [], returns: T },
      ],
    });

    expect(schema.types.map((t) => t.name)).toEqual(["Alpha", "Zed"]);

    const zed = schema.types[1]!;
    if (zed.kind !== "class") throw new Error("Zed is a class");

    expect(zed.methods!.map((m) => `${m.name}:${m.symbol}`)).toEqual([
      "a:objc:1",
      "a:objc:9",
      "b:objc:2",
    ]);
    expect(zed.properties!.map((p) => p.name)).toEqual(["x", "y"]);
    expect(schema.functions!.map((f) => f.name)).toEqual(["f", "g"]);
  });

  it("keeps the order that carries meaning: enum cases, struct fields, parameters", () => {
    const schema = canonicalSchema({
      format: SCHEMA_FORMAT,
      platform: "ios",
      module: "M",
      types: [
        {
          kind: "enum",
          name: "E",
          native: "E",
          cases: [
            { name: "z", native: "z", value: 0 },
            { name: "a", native: "a", value: 1 },
          ],
        },
        {
          kind: "struct",
          name: "S",
          native: "S",
          fields: [
            { name: "y", type: T },
            { name: "x", type: T },
          ],
        },
      ],
    });

    const [e, st] = schema.types;
    expect(e!.kind === "enum" && e!.cases.map((c) => c.name)).toEqual(["z", "a"]);
    expect(st!.kind === "struct" && st!.fields.map((f) => f.name)).toEqual(["y", "x"]);
  });
});

describe("schema types", () => {
  it("writes and reads a copied list (Kotlin's read-only List) as List<E>", () => {
    const t = parseSchemaType("List<List<int?>>?");

    expect(t).toEqual({
      k: "array",
      list: true,
      nullable: true,
      of: {
        k: "array",
        list: true,
        nullable: false,
        of: { k: "prim", name: "int", nullable: true },
      },
    });
    expect(formatSchemaType(t)).toBe("List<List<int?>>?");
    // A qualified name is the Java class: its own object, not a copy.
    expect(parseSchemaType("java.util.List<string>")).toMatchObject({
      k: "ref",
      module: "java.util",
      name: "List",
    });
  });

  it("writes and reads a Swift tuple, its labels kept, as [label: T, …]", () => {
    const t = parseSchemaType("[min: double, max: Shapes.Point]?");

    expect(t).toEqual({
      k: "tuple",
      nullable: true,
      items: [
        { label: "min", type: { k: "prim", name: "double", nullable: false } },
        { label: "max", type: { k: "ref", module: "Shapes", name: "Point", nullable: false } },
      ],
    });
    expect(formatSchemaType(t)).toBe("[min: double, max: Shapes.Point]?");
    // Unlabeled, and an array of tuples.
    expect(formatSchemaType(parseSchemaType("[double, string][]"))).toBe("[double, string][]");
  });
});
