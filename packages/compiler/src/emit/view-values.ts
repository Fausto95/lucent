/**
 * A component's values between the renderer's side (its Fabric header's
 * plain C++: LucentViews.h) and Lucent's: the props a commit holds and a
 * command's arguments become Lucent values (lucent::views::lucent* in
 * LucentViewValues.h); event arguments and a request's answer go back into
 * the renderer's types (lucent::views::assign*). Every kind of view value:
 * numbers, booleans, strings, string literal unions, arrays, plain objects,
 * each maybe null or missing.
 */
import { cpp } from "@lucent-lang/codegen";
import { cppIdent, type LType } from "../types.ts";
import type { ViewField, ViewType } from "../ui/contract.ts";
import { fabricNames } from "../ui/fabric.ts";
import type { Ctx } from "./context.ts";

type X = cpp.Expr;

const views = (name: string) => cpp.id(`lucent::views::${name}`);
const auto = cpp.param(cpp.constType(cpp.reference(cpp.auto)), "value");
const constRef = (t: cpp.Type) => cpp.reference(cpp.constType(t));

// --- values ---------------------------------------------------------------------------

/** Lucent's value of type `lt` for the renderer's value `r` of view type `vt`. */
export function toLucent(ctx: Ctx, vt: ViewType, lt: LType, r: X): X {
  const each = (inner: X) => cpp.lambda(["&"], [auto], [cpp.ret(inner)]);
  const value = cpp.id("value");

  switch (vt.k) {
    case "number":
    case "boolean":
      return r;
    case "string":
      return cpp.call(views("lucentString"), [r]);
    case "enum":
      return cpp.call(views("lucentString"), [cpp.dot(r, "value")]);
    case "array": {
      const e = element(lt);

      return cpp.call(
        views("lucentArray"),
        [r, each(toLucent(ctx, vt.element, e, value))],
        [ctx.reg.cppType(e)],
      );
    }
    case "nullable": {
      const inner = unwrapped(lt);

      return cpp.call(
        views("lucentNullable"),
        [r, each(toLucent(ctx, vt.inner, inner, value))],
        [ctx.reg.cppType(inner)],
      );
    }
    case "object": {
      const struct = ctx.reg.struct(structId(lt));
      const names = fabricNames.object(vt.fields);
      const s = cpp.id("s");

      return cpp.call(
        cpp.lambda(
          ["&"],
          [],
          [
            cpp.varDecl(
              cpp.auto,
              "s",
              cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${struct.cppName}`)]),
            ),
            ...vt.fields.map((f, i) =>
              cpp.exprStmt(
                cpp.assign(
                  cpp.arrow(s, cppIdent(f.name)),
                  fieldToLucent(ctx, f, fieldType(struct.fields, f.name), cpp.dot(r, names[i]!)),
                ),
              ),
            ),
            cpp.ret(s),
          ],
        ),
      );
    }
  }
}

/** A field's value: `r` is optional (std::optional) when the field is. */
export function fieldToLucent(ctx: Ctx, f: ViewField, lt: LType, r: X): X {
  if (!f.optional) return toLucent(ctx, f.type, lt, r);

  const inner = unwrapped(lt);
  // A nullable field's value is itself an Opt, which lucentOptional keeps.
  const value = toLucent(ctx, f.type, f.type.k === "nullable" ? lt : inner, cpp.id("value"));

  return cpp.call(
    views("lucentOptional"),
    [r, cpp.lambda(["&"], [auto], [cpp.ret(value)])],
    [ctx.reg.cppType(inner)],
  );
}

/** Statements setting the renderer's value `target` of view type `vt` from Lucent's `src`. */
export function assignRepr(ctx: Ctx, target: X, vt: ViewType, lt: LType, src: X): cpp.Stmt[] {
  const set = (value: X) => [cpp.exprStmt(cpp.assign(target, value))];
  const each = (body: (t: X, e: X) => cpp.Stmt[]) =>
    cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.auto), "out"), cpp.param(constRef(cpp.auto), "in")],
      body(cpp.id("out"), cpp.id("in")),
    );

  switch (vt.k) {
    case "number":
    case "boolean":
      return set(src);
    case "string":
      return set(cpp.call(views("utf8"), [src]));
    case "enum":
      return [cpp.exprStmt(cpp.assign(cpp.dot(target, "value"), cpp.call(views("utf8"), [src])))];
    case "array":
      return [
        cpp.exprStmt(
          cpp.call(views("assignArray"), [
            target,
            src,
            each((t, e) => assignRepr(ctx, t, vt.element, element(lt), e)),
          ]),
        ),
      ];
    case "nullable":
      return [
        cpp.exprStmt(
          cpp.call(views("assignOpt"), [
            target,
            src,
            each((t, e) => assignRepr(ctx, t, vt.inner, unwrapped(lt), e)),
          ]),
        ),
      ];
    case "object": {
      const struct = ctx.reg.struct(structId(lt));
      const names = fabricNames.object(vt.fields);

      return vt.fields.flatMap((f, i) =>
        assignFieldRepr(
          ctx,
          cpp.dot(target, names[i]!),
          f,
          fieldType(struct.fields, f.name),
          cpp.arrow(src, cppIdent(f.name)),
        ),
      );
    }
  }
}

/** A field or parameter: absent when optional and undefined, empty when nullable and null. */
export function assignFieldRepr(ctx: Ctx, target: X, f: ViewField, lt: LType, src: X): cpp.Stmt[] {
  if (!f.optional) return assignRepr(ctx, target, f.type, lt, src);

  const each = (vt: ViewType, inner: LType) =>
    cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.auto), "out"), cpp.param(constRef(cpp.auto), "in")],
      assignRepr(ctx, cpp.id("out"), vt, inner, cpp.id("in")),
    );

  if (f.type.k === "nullable")
    return [
      cpp.exprStmt(
        cpp.call(views("assignOptionalNullable"), [target, src, each(f.type.inner, unwrapped(lt))]),
      ),
    ];

  return [cpp.exprStmt(cpp.call(views("assignOpt"), [target, src, each(f.type, unwrapped(lt))]))];
}

function unwrapped(lt: LType): LType {
  if (lt.k !== "opt") throw new Error(`expected an optional type (got ${lt.k})`);

  return lt.inner;
}

function element(lt: LType): LType {
  if (lt.k !== "array") throw new Error(`expected an array type (got ${lt.k})`);

  return lt.e;
}

function structId(lt: LType): string {
  if (lt.k !== "struct") throw new Error(`expected a struct type (got ${lt.k})`);

  return lt.id;
}

function fieldType(fields: readonly { name: string; type: LType }[], name: string): LType {
  const field = fields.find((f) => f.name === name);

  if (!field) throw new Error(`the Lucent type has no field ${name}`);

  return field.type;
}
