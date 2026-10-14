/**
 * The web APIs the runtime implements beyond the ECMAScript library:
 * TextEncoder and TextDecoder, for UTF-8, by the Encoding standard
 * (lucent/text.h), and URL and URLSearchParams, by the URL standard, on
 * the vendored Ada parser (lucent/url.h). Each is exact or refused: a
 * TextDecoder decodes UTF-8 only, so a label naming another encoding is a
 * diagnostic when it is written in the call (a RangeError when it is
 * computed), and options are written in the call, where the compiler sees
 * which are given. A program that makes a URL has the native package carry
 * Ada (EmitContext.urls).
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { cppIdent, isVoidish, type LType, stripOpt, T, typeKey, unionOf } from "../types.ts";
import type { E, Lvalue } from "./context.ts";
import { callback } from "./builtins.ts";
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

/** `new TextEncoder()`, `new TextDecoder(label, { fatal, ignoreBOM })`, `new URL(…)`, `new URLSearchParams(…)`. */
export function webNew(em: FnEmitter, node: ts.NewExpression, t: WebT): E {
  const a = node.arguments ?? ts.factory.createNodeArray();

  if (t.name === "URL") {
    em.ctx.urls = true;
    if (!a[0]) fail(node, Codes.UnsupportedBuiltin, "new URL() takes the URL");
    return {
      c: cpp.call("lucent::URLObject::make", [urlText(em, a[0]), optionalUrlText(em, a[1])]),
      t,
    };
  }
  if (t.name === "URLSearchParams") {
    em.ctx.urls = true;
    return { c: searchParamsFrom(em, a[0]), t };
  }
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

  if (t.name === "URL" || t.name === "URLSearchParams") return urlProperty(obj, name);

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

  if (t.name === "URL" || t.name === "URLSearchParams") return urlMethod(em, obj, name, node);

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

// --- URL and URLSearchParams ------------------------------------------------------------------

const URL_T: LType = { k: "web", name: "URL" };
const PARAMS_T: LType = { k: "web", name: "URLSearchParams" };
const PAIR_T: LType = { k: "tuple", es: [T.string, T.string] };

/** A URL's parts, each a string JavaScript reads and writes; `origin` is read only. */
const URL_PARTS = new Map<string, string>([
  ["href", "Href"],
  ["protocol", "Protocol"],
  ["username", "Username"],
  ["password", "Password"],
  ["host", "Host"],
  ["hostname", "Hostname"],
  ["port", "Port"],
  ["pathname", "Pathname"],
  ["search", "Search"],
  ["hash", "Hash"],
]);

/** A URL argument as text: a string, or a URL's href. */
function urlText(em: FnEmitter, arg: ts.Expression): cpp.Expr {
  const v = em.expr(arg);
  if (v.t.k === "web" && v.t.name === "URL") return cpp.call(cpp.arrow(v.c, "href"), []);
  if (v.t.k !== "string")
    fail(arg, Codes.UnsupportedBuiltin, `a URL is a string or a URL, not ${typeKey(v.t)}`);
  return v.c;
}

/** A base URL argument, which may be left out: an Opt<String>. */
function optionalUrlText(em: FnEmitter, arg: ts.Expression | undefined): cpp.Expr {
  const optionalString = unionOf([T.string, T.undefined]);
  const none = cpp.construct(em.reg.cppType(optionalString), [cpp.id("lucent::undefined")]);

  if (!arg) return none;
  const v = em.expr(arg);
  if (v.t.k === "web" && v.t.name === "URL")
    return cpp.construct(em.reg.cppType(optionalString), [cpp.call(cpp.arrow(v.c, "href"), [])]);
  if (v.t.k !== "string" && !(v.t.k === "opt" && v.t.inner.k === "string") && !isVoidish(v.t))
    fail(arg, Codes.UnsupportedBuiltin, `a base URL is a string or a URL, not ${typeKey(v.t)}`);
  return isVoidish(v.t) ? none : em.coerce(v, optionalString, arg);
}

/** What `new URLSearchParams(init)` makes, by what init is. */
function searchParamsFrom(em: FnEmitter, init: ts.Expression | undefined): cpp.Expr {
  const make = (how: string, args: cpp.Expr[]) =>
    cpp.call(`lucent::URLSearchParamsObject::${how}`, args);

  if (!init) return cpp.call("std::make_shared", [], [cpp.type("lucent::URLSearchParamsObject")]);
  // An object literal is a record of names to values, in the order it writes them.
  if (ts.isObjectLiteralExpression(init))
    return make("fromRecord", [em.exprAs(init, { k: "dict", val: T.string })]);

  const v = em.expr(init);
  const t = v.t;
  if (t.k === "string") return make("fromString", [v.c]);
  if (t.k === "dict" && t.val.k === "string") return make("fromRecord", [v.c]);
  if (t.k === "web" && t.name === "URLSearchParams") return make("copy", [v.c]);
  if (t.k === "array" && t.e.k === "array" && t.e.e.k === "string") return make("fromPairs", [v.c]);
  if (t.k === "array" && t.e.k === "tuple" && typeKey(t.e) === typeKey(PAIR_T))
    return make("fromTuples", [v.c]);
  fail(
    init,
    Codes.UnsupportedBuiltin,
    `new URLSearchParams() takes a string, a Record<string, string>, [name, value] pairs or another URLSearchParams, not ${typeKey(t)}`,
  );
}

/** `URL.canParse(url, base)`, `URL.parse(url, base)`. */
export function urlStatic(em: FnEmitter, node: ts.CallExpression, name: string): E {
  const a = node.arguments;
  em.ctx.urls = true;

  if ((name !== "canParse" && name !== "parse") || !a[0])
    fail(node, Codes.UnsupportedBuiltin, `URL.${name} is not supported`);
  const args = [urlText(em, a[0]), optionalUrlText(em, a[1])];
  return name === "canParse"
    ? { c: cpp.call("lucent::URLObject::canParse", args), t: T.boolean }
    : { c: cpp.call("lucent::URLObject::parse", args), t: unionOf([URL_T, T.null]) };
}

/** The place `url.pathname` (and the other parts) names, which a write sets through the URL. */
export function webLvalue(obj: E, name: string): Lvalue | undefined {
  const t = obj.t as WebT;
  const part = URL_PARTS.get(name);

  if (t.name !== "URL" || !part) return undefined;
  return {
    get: cpp.call(cpp.arrow(obj.c, name), []),
    set: (v) => cpp.call(cpp.arrow(obj.c, `set${part}`), [v]),
    type: T.string,
  };
}

function urlProperty(obj: E, name: string): E | undefined {
  const t = obj.t as WebT;
  const o = obj.c;

  if (t.name === "URL") {
    if (URL_PARTS.has(name) || name === "origin")
      return { c: cpp.call(cpp.arrow(o, name), []), t: T.string };
    if (name === "searchParams")
      return { c: cpp.call(cpp.arrow(o, "searchParams"), []), t: PARAMS_T };
  }
  if (t.name === "URLSearchParams" && name === "size")
    return { c: cpp.call(cpp.arrow(o, "size"), []), t: T.number };
  return undefined;
}

function urlMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E | undefined {
  const t = obj.t as WebT;
  const o = obj.c;
  const a = node.arguments;
  const text = (i: number) => em.exprAs(a[i]!, T.string);
  const optionalText = (i: number) => {
    const optionalString = unionOf([T.string, T.undefined]);
    return a[i]
      ? em.exprAs(a[i], optionalString)
      : cpp.construct(em.reg.cppType(optionalString), [cpp.id("lucent::undefined")]);
  };
  const call = (method: string, args: cpp.Expr[], type: LType): E => ({
    c: cpp.call(cpp.arrow(o, method), args),
    t: type,
  });

  if (t.name === "URL" && (name === "toString" || name === "toJSON"))
    return call(name, [], T.string);
  if (t.name !== "URLSearchParams") return undefined;

  switch (name) {
    case "append":
    case "set":
      return call(name, [text(0), text(1)], T.undefined);
    case "delete":
      return call("remove", [text(0), optionalText(1)], T.undefined);
    case "get":
      return call("get", [text(0)], unionOf([T.string, T.null]));
    case "getAll":
      return call("getAll", [text(0)], { k: "array", e: T.string });
    case "has":
      return call("has", [text(0), optionalText(1)], T.boolean);
    case "sort":
      return call("sort", [], T.undefined);
    case "toString":
      return call("toString", [], T.string);
    case "keys":
    case "values":
      return call(name, [], { k: "iter", e: T.string });
    case "entries":
      return call("entries", [], { k: "iter", e: PAIR_T });
    case "forEach": {
      if (a.length !== 1)
        fail(
          node,
          Codes.UnsupportedBuiltin,
          "forEach takes the callback (thisArg is not supported)",
        );
      const f = callback(em, a[0], [T.string, T.string, PARAMS_T], T.void);
      return call("forEach", [f.c], T.undefined);
    }
  }
  return undefined;
}
