import { describe, expect, it } from "vite-plus/test";
import type { SdkCallable } from "../src/schema.ts";
import { parseSchemaType } from "../src/schema.ts";
import { factoriesOfSameTyped } from "../src/swift.ts";

/*
 * Swift initializers `new` cannot stand for: those whose parameters'
 * types are the same, and async ones (`new` cannot wait), each a static
 * factory instead.
 */

const param = (name: string, type: string) => ({ name, type: parseSchemaType(type) });

describe("Swift initializers as static factories", () => {
  it("make an async initializer a factory giving the object, by its labels or `make`", () => {
    const ctors: SdkCallable[] = [
      {
        params: [param("url", "string")],
        swift: { name: "init(contentsOf:)", async: true, throws: true },
      },
      { params: [], swift: { name: "init()", async: true } },
      { params: [param("name", "string")], swift: { name: "init(name:)" } },
    ];
    const r = factoriesOfSameTyped(ctors, "Gauges.Model");

    expect(r.ctors).toEqual([ctors[2]]);
    expect(r.factories.map((f) => [f.name, f.static, f.swift?.name, f.swift?.async])).toEqual([
      ["withContentsOf", true, "init(contentsOf:)", true],
      ["make", true, "init()", true],
    ]);
    expect(r.factories[0]!.returns).toEqual(parseSchemaType("Gauges.Model"));
  });

  it("leave a lone synchronous initializer as the constructor", () => {
    const ctors: SdkCallable[] = [
      { params: [param("name", "string")], swift: { name: "init(name:)" } },
    ];
    expect(factoriesOfSameTyped(ctors, "Gauges.Model")).toEqual({ ctors, factories: [] });
  });
});
