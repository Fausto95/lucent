/** C++ spelling of a JavaScript number. */
export function numberLiteral(v: number): string {
  if (Number.isNaN(v)) return "lucent::kNaN";
  if (v === Infinity) return "lucent::kInfinity";
  if (v === -Infinity) return "(-lucent::kInfinity)";
  if (Object.is(v, -0)) return "(-0.0)";
  let s = String(v);
  if (!/[.eE]/.test(s)) s += ".0";
  return v < 0 ? `(${s})` : s;
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

/** A C++ string literal holding the UTF-8 bytes of `s` (escaped). */
export function cppQuoted(s: string): string {
  const bytes = Buffer.from(s, "utf8");
  let out = '"';
  for (const b of bytes) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += "\\\\";
    else if (b >= 0x20 && b < 0x7f && b !== 0x3f) out += String.fromCharCode(b);
    else out += "\\" + b.toString(8).padStart(3, "0");
  }
  return out + '"';
}

/** A `lucent::String` for a JavaScript string literal, built once per site. */
export function stringLiteral(s: string): string {
  if (s.length === 0) return "lucent::String()";
  if (hasLoneSurrogate(s)) {
    let out = 'u"';
    for (let i = 0; i < s.length; i++) out += `\\u${s.charCodeAt(i).toString(16).padStart(4, "0")}`;
    return `LUCENT_STR16(${out}")`;
  }
  return `LUCENT_STR(${cppQuoted(s)})`;
}
