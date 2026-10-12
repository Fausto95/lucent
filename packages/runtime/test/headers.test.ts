/**
 * What the runtime's headers may declare, beyond what the compilers check:
 * each header is compiled into every unit that includes it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const cpp = path.resolve(import.meta.dirname, "../cpp");

function headers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "third_party" ? [] : headers(p);
    return e.name.endsWith(".h") ? [p] : [];
  });
}

/** A type a thread-local needs no initialization routine for: a scalar, or a pointer. */
const SCALAR =
  /^(?:bool|char|int|long|unsigned(?: \w+)?|size_t|uintptr_t|u?int\d+_t|double|float|[\w:<>]+ ?\*)$/;

describe("the runtime's headers", () => {
  it("declare thread-locals only of scalars and pointers", () => {
    // A thread-local of a type with a constructor or a destructor gets an
    // initialization routine in every unit that uses it, and Apple's linker
    // refuses those as duplicate symbols in a static library.
    const found = headers(cpp).flatMap((file) =>
      [
        ...fs
          .readFileSync(file, "utf8")
          .matchAll(/^\s*(?:static\s+)?inline\s+thread_local\s+(.+?)\s+(\w+)\s*(?:=|\{|;)/gm),
      ]
        .filter((m) => !SCALAR.test(m[1]!.trim()))
        .map((m) => `${path.relative(cpp, file)}: ${m[1]} ${m[2]}`),
    );

    expect(found).toEqual([]);
  });
});
