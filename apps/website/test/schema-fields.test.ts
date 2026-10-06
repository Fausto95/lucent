import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { commands } from "../../../packages/lucent/src/cli/commands.ts";
import {
  jsonOutputs,
  type SchemaNode,
  schemaFields,
} from "../../../scripts/website/schema-fields.ts";

const schemas = path.join(import.meta.dirname, "../../../packages/lucent/schemas");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(schemas, file), "utf8"));

describe("schemaFields", () => {
  it("lists every field, nested ones by path, with its type and whether it's required", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: {
        a: { type: "string", description: "A name." },
        b: { type: "array", items: { type: "object", properties: { c: { enum: ["x", "y"] } } } },
        m: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["d"],
            properties: { d: { const: "k" } },
          },
        },
        u: { anyOf: [{ type: "string" }, { type: "number" }] },
        r: { $ref: "#/definitions/R" },
      },
      definitions: { R: { type: "object", properties: { e: { type: "boolean" } } } },
    };

    expect(schemaFields(schema)).toEqual([
      { field: "a", type: "string", required: true, description: "A name." },
      { field: "b", type: "object[]", required: false, description: "" },
      { field: "b[].c", type: '"x" or "y"', required: false, description: "" },
      { field: "m", type: "{ [name]: object }", required: false, description: "" },
      { field: "m.<name>.d", type: '"k"', required: true, description: "" },
      { field: "u", type: "string or number", required: false, description: "" },
      { field: "r", type: "object", required: false, description: "" },
      { field: "r.e", type: "boolean", required: false, description: "" },
    ]);
  });

  it("merges the fields of a union's members, once each", () => {
    const schema: SchemaNode = {
      type: "object",
      properties: {
        v: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "exact" }, version: { type: "string" } },
            },
            {
              type: "object",
              properties: { kind: { const: "branch" }, branch: { type: "string" } },
            },
          ],
        },
      },
    };

    expect(schemaFields(schema).map((f) => [f.field, f.type])).toEqual([
      ["v", "object"],
      ["v.kind", '"exact" or "branch"'],
      ["v.version", "string"],
      ["v.branch", "string"],
    ]);
  });

  it("reaches the deepest fields of lucent.json", () => {
    const fields = schemaFields(read("lucent.schema.json")).map((f) => f.field);

    expect(fields).toContain("android.components[].intentFilters[].data[].scheme");
    expect(fields).toContain("extensions.<name>.functions.<name>.failsWhen");
    expect(fields).toContain("ios.swiftPackages.<name>.requirement.kind");
  });
});

describe("jsonOutputs", () => {
  it("names the command each --json schema describes", () => {
    const files = fs.readdirSync(schemas).filter((f) => (read(f).title ?? "").endsWith(" --json"));
    const outputs = jsonOutputs(
      files.map((file) => ({ file, schema: read(file) })),
      commands,
    );

    expect(outputs.map((o) => o.command).sort()).toEqual(
      [
        "build",
        "check",
        "clean",
        "doctor",
        "explain",
        "new module",
        "sdk coverage",
        "sdk diff",
        "sdk lock",
        "sdk prefetch",
        "sdk search",
        "sdk show",
      ].sort(),
    );
  });

  it("gives each public command a schema lists its own entry, leaving internal ones out", () => {
    const outputs = jsonOutputs(
      [{ file: "new.schema.json", schema: { title: "lucent new a --json, lucent new b --json" } }],
      [{ name: "new a" }, { name: "new b", internal: true }],
    );

    expect(outputs.map((o) => o.command)).toEqual(["new a"]);
  });

  it("gives each member of a top-level oneOf its own fields, required as that member says", () => {
    const [explain] = jsonOutputs(
      [{ file: "explain.schema.json", schema: read("explain.schema.json") }],
      commands,
    );

    expect(
      explain!.variants.map((v) => ({
        description: v.description,
        required: v.fields.filter((f) => f.required).map((f) => f.field),
      })),
    ).toEqual([
      {
        description: "Without a code: every code",
        required: ["codes", "codes[].code", "codes[].title"],
      },
      {
        description: "One code",
        required: ["code", "title", "summary", "details", "fix", "wrong", "right", "docs"],
      },
    ]);
  });

  it("gives a schema without a top-level oneOf one variant", () => {
    const [output] = jsonOutputs(
      [
        {
          file: "a.schema.json",
          schema: {
            title: "lucent a --json",
            type: "object",
            properties: { b: { type: "string" } },
          },
        },
      ],
      [{ name: "a" }],
    );

    expect(output!.variants).toEqual([
      {
        description: "",
        fields: [{ field: "b", type: "string", required: false, description: "" }],
      },
    ]);
  });

  it("fails on a schema for a command that doesn't exist", () => {
    expect(() =>
      jsonOutputs(
        [{ file: "nope.schema.json", schema: { title: "lucent nope --json" } }],
        [{ name: "build" }],
      ),
    ).toThrow("nope.schema.json: there is no `lucent nope` command");
  });
});
