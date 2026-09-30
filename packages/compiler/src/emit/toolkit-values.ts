/**
 * Plain data crossing from a setup into its toolkit body, encoded the way
 * view values are described (ui/contract.ts's ViewType): the C++ that
 * turns a Lucent value into the objects the toolkit's side decodes. Each
 * toolkit's runtime (lucent/platform/swiftui.h, compose.h) has the same
 * functions, over Foundation objects or Java ones:
 *
 * - `value(x)`: a number, a boolean or a string (NSNumber, NSString;
 *   java.lang.Double, Boolean, String);
 * - `optional(x, each)`: nothing (NSNull, null) or `each` of the value;
 * - `array(x, each)`: `each` of every element, in an array;
 * - `record({ … })`: an object's fields, in the order its type declares
 *   them, in an array: the generated Swift or Kotlin reads them back by
 *   place.
 *
 * A string literal union crosses as its string.
 */
import { cpp } from "@lucent-lang/codegen";
import { cppIdent, type LType, T } from "../types.ts";
import type { ViewType } from "../ui/contract.ts";
import type { ScalarType } from "../ui/toolkit-body.ts";
import type { Ctx } from "./context.ts";

/** The encoded `value`, of Lucent type `lt` and view type `vt`, with `runtime`'s functions. */
export function encoded(
  ctx: Ctx,
  runtime: string,
  vt: ViewType,
  lt: LType,
  value: cpp.Expr,
): cpp.Expr {
  const fn = (name: string) => cpp.id(`${runtime}::${name}`);
  const each = (inner: (x: cpp.Expr) => cpp.Expr) =>
    cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x")],
      [cpp.ret(inner(cpp.id("x")))],
    );

  // Null and undefined cross alike: nothing.
  if (lt.k === "opt") {
    const inner = vt.k === "nullable" ? vt.inner : vt;

    return cpp.call(fn("optional"), [
      value,
      each((x) => encoded(ctx, runtime, inner, lt.inner, x)),
    ]);
  }

  switch (vt.k) {
    case "number":
    case "boolean":
    case "string":
    case "enum":
      return cpp.call(fn("value"), [value]);
    case "nullable":
      return encoded(ctx, runtime, vt.inner, lt, value);
    case "array": {
      if (lt.k !== "array") throw new Error(`expected an array type (got ${lt.k})`);

      const element = lt.e;

      return cpp.call(fn("array"), [
        value,
        each((x) => encoded(ctx, runtime, vt.element, element, x)),
      ]);
    }
    case "object": {
      if (lt.k !== "struct") throw new Error(`expected a struct type (got ${lt.k})`);

      const struct = ctx.reg.struct(lt.id);
      const s = cpp.id("s");
      const fields = vt.fields.map((f) => {
        const field = struct.fields.find((x) => x.name === f.name);

        if (!field) throw new Error(`the Lucent type has no field ${f.name}`);

        return encoded(ctx, runtime, f.type, field.type, cpp.arrow(s, cppIdent(f.name)));
      });

      // A braced list: the fields are encoded in order.
      return cpp.call(
        cpp.lambda(
          ["&"],
          [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "s")],
          [cpp.ret(cpp.call(fn("record"), [cpp.initList(fields)]))],
        ),
        [value],
      );
    }
  }
}

const SCALARS: Record<ScalarType["k"], LType> = {
  number: T.number,
  boolean: T.boolean,
  string: T.string,
};

/** The Lucent type of a number, a boolean or a string crossing between a body and its setup. */
export function scalarType(t: ScalarType): LType {
  return t.nullable ? { k: "opt", inner: SCALARS[t.k] } : SCALARS[t.k];
}
