/**
 * The web APIs the runtime implements beyond the ECMAScript library
 * (lucent/text.h): TextEncoder and TextDecoder, for UTF-8, by the Encoding
 * standard. Each is exact or refused: a TextDecoder decodes UTF-8 only, so
 * a label naming another encoding is a diagnostic when it is written in
 * the call (a RangeError when it is computed), and options are written in
 * the call, where the compiler sees which are given.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { cppIdent, isVoidish, type LType, stripOpt, T, typeKey, unionOf } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";

type WebT = LType & { k: "web" };

/** The labels of UTF-8, as the Encoding standard lists them. */
const UTF8_LABELS = new Set([
  "unicode-1-1-utf-8",
  "unicode11utf8",
  "unicode20utf8",
  "utf-8",
  "utf8",
  "x-unicode20utf8",
]);

/** A label as the Encoding standard matches it: without ASCII whitespace around it, in lowercase. */
function labelKey(label: string): string {
  return label
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The properties of an options object written in the call, by name: an
 * object literal of `names`, or nothing (left out, or undefined).
 */
function optionsOf(
  em: FnEmitter,
  options: ts.Expression | undefined,
  names: readonly string[],
  call: string,
): Map<string, ts.Expression> {
  const given = new Map<string, ts.Expression>();

  if (!options || (ts.isIdentifier(options) && isVoidish(em.lt(options)))) return given;

  const written = names.map((n) => `${n}: …`).join(", ");

  if (!ts.isObjectLiteralExpression(options))
    fail(
      options,
      Codes.UnsupportedBuiltin,
      `${call}'s options are written in the call, as an object literal: { ${written} }`,
    );

  for (const p of options.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      names.includes(p.name.text)
    )
      given.set(p.name.text, p.initializer);
    else if (ts.isShorthandPropertyAssignment(p) && names.includes(p.name.text))
      given.set(p.name.text, p.name);
    else
      fail(
        p,
        Codes.UnsupportedBuiltin,
        `${call}'s options are ${names.map((n) => `\`${n}\``).join(" and ")}`,
      );
  }
  return given;
}

/** An option's value as a boolean (ToBoolean, as WebIDL converts it): false when not given. */
function flag(em: FnEmitter, given: Map<string, ts.Expression>, name: string): cpp.Expr {
  const value = given.get(name);
  return value ? em.cond(value) : cpp.id("false");
}

/** `new TextEncoder()`, `new TextDecoder(label, { fatal, ignoreBOM })`. */
export function webNew(em: FnEmitter, node: ts.NewExpression, t: WebT): E {
  const a = node.arguments ?? ts.factory.createNodeArray();

  if (t.name === "TextEncoder")
    return { c: cpp.call("std::make_shared", [], [cpp.type("lucent::TextEncoderObject")]), t };

  const optionalString = unionOf([T.string, T.undefined]);
  const noLabel = cpp.construct(em.reg.cppType(optionalString), [cpp.id("lucent::undefined")]);
  const label = a[0];
  let named = noLabel;

  if (label && ts.isStringLiteralLike(label)) {
    // Checked here: a label written in the call names UTF-8, or the call is refused.
    if (!UTF8_LABELS.has(labelKey(label.text)))
      fail(
        label,
        Codes.UnsupportedBuiltin,
        `Lucent's TextDecoder decodes UTF-8 only, not "${label.text}": decode the bytes with the platform's API`,
      );
  } else if (label) {
    named = em.exprAs(label, optionalString);
  }

  const given = optionsOf(em, a[1], ["fatal", "ignoreBOM"], "new TextDecoder()");
  return {
    c: cpp.call("lucent::makeTextDecoder", [
      named,
      flag(em, given, "fatal"),
      flag(em, given, "ignoreBOM"),
    ]),
    t,
  };
}

export function webProperty(obj: E, name: string): E | undefined {
  const t = obj.t as WebT;
  const o = obj.c;

  if (name === "encoding") return { c: cpp.call(cpp.arrow(o, "encoding"), []), t: T.string };
  if (t.name === "TextDecoder" && (name === "fatal" || name === "ignoreBOM"))
    return { c: cpp.arrow(o, name), t: T.boolean };
  return undefined;
}

/** What `decode` takes: bytes of any view, or a buffer's; undefined, as nothing. */
const DECODED = new Set<LType["k"]>(["bytes", "typed", "dataView", "arrayBuffer"]);

export function webMethod(
  em: FnEmitter,
  obj: E,
  name: string,
  node: ts.CallExpression,
): E | undefined {
  const t = obj.t as WebT;
  const o = obj.c;
  const a = node.arguments;

  if (t.name === "TextEncoder" && name === "encode") {
    const input = a[0];
    if (!input) return { c: cpp.call(cpp.arrow(o, "encode"), []), t: T.bytes };
    const it = em.lt(input);
    const as = it.k === "string" ? T.string : unionOf([T.string, T.undefined]);
    return { c: cpp.call(cpp.arrow(o, "encode"), [em.exprAs(input, as)]), t: T.bytes };
  }

  if (t.name === "TextEncoder" && name === "encodeInto") {
    const result = em.lt(node);
    if (result.k !== "struct" || a.length !== 2)
      fail(node, Codes.UnsupportedBuiltin, "encodeInto takes a string and the Uint8Array to write");
    const info = em.reg.struct(result.id);
    const source = em.exprAs(a[0]!, T.string);
    const destination = em.exprAs(a[1]!, T.bytes);
    const r = cpp.id("r");

    // The runtime counts into the result's fields.
    return {
      c: cpp.call(
        cpp.lambda(
          [],
          [
            cpp.param(cpp.type("lucent::TextEncoder"), "e"),
            cpp.param(cpp.type("lucent::String"), "s"),
            cpp.param(cpp.type("lucent::Bytes"), "d"),
          ],
          [
            cpp.varDecl(
              cpp.auto,
              "r",
              cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]),
            ),
            cpp.exprStmt(
              cpp.call(cpp.arrow(cpp.id("e"), "encodeInto"), [
                cpp.id("s"),
                cpp.id("d"),
                cpp.arrow(r, cppIdent("read")),
                cpp.arrow(r, cppIdent("written")),
              ]),
            ),
            cpp.ret(r),
          ],
          { ret: em.reg.cppType(result) },
        ),
        [o, source, destination],
      ),
      t: result,
    };
  }

  if (t.name === "TextDecoder" && name === "decode") {
    const [input, options] = a;
    let bytes: cpp.Expr[] = [];

    if (input) {
      const v = em.expr(input);
      const vt = stripOpt(v.t);
      if (!DECODED.has(vt.k) && !isVoidish(vt))
        fail(
          input,
          Codes.UnsupportedBuiltin,
          `decode takes a typed array, a DataView or an ArrayBuffer, not ${typeKey(v.t)}`,
        );
      if (!isVoidish(vt)) bytes = [v.c];
    }

    const given = optionsOf(em, options, ["stream"], "decode()");
    return {
      c: cpp.call(cpp.arrow(o, "decode"), [...bytes, flag(em, given, "stream")]),
      t: T.string,
    };
  }

  return undefined;
}
