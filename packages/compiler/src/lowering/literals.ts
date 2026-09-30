/** C++ spellings of JavaScript literals, shared by the legacy emitter and the IR. */
import { cpp } from "@lucent-lang/codegen";

/** A JavaScript number as a C++ double: the constants for NaN and infinities, -0 kept. */
export function numberExpr(v: number): cpp.Expr {
  if (Number.isNaN(v)) return cpp.id("lucent::kNaN");
  if (v === Infinity) return cpp.id("lucent::kInfinity");
  if (v === -Infinity) return cpp.unary("-", cpp.id("lucent::kInfinity"));
  if (Object.is(v, -0)) return cpp.num("-0.0");
  let s = String(Math.abs(v));
  if (!/[.eE]/.test(s)) s += ".0";
  return v < 0 ? cpp.unary("-", cpp.num(s)) : cpp.num(s);
}

const INT64_MIN = -(2n ** 63n);

const INT64_MAX = 2n ** 63n - 1n;

/**
 * A JavaScript bigint as a lucent::BigInt: inline when it fits in int64
 * (no allocation), else parsed once per site from its decimal digits.
 */
export function bigintExpr(v: bigint): cpp.Expr {
  if (v > INT64_MIN && v <= INT64_MAX)
    return cpp.call("lucent::BigInt::fromInt64", [cpp.num(String(v))]);

  return cpp.call("LUCENT_BIGINT", [cpp.str(String(v))]);
}

/** The value of a bigint literal's text (`0xffn`, `1_000n`). */
export function bigintLiteralValue(text: string): bigint {
  return BigInt(text.slice(0, -1).replace(/_/g, ""));
}

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** A `lucent::String` for a JavaScript string literal, built once per site. */
export function stringExpr(s: string): cpp.Expr {
  if (s.length === 0) return cpp.construct(cpp.type("lucent::String"));
  // Lone surrogates have no UTF-8: UTF-16 units instead.
  if (hasLoneSurrogate(s)) return cpp.call("LUCENT_STR16", [cpp.str16(s)]);
  return cpp.call("LUCENT_STR", [cpp.str(s)]);
}
