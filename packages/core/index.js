"use strict";
// JavaScript implementations of @lucent-lang/core, used when a Lucent module
// runs as plain TypeScript (tests, web). Native builds use the C++ runtime.

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function error(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function errorCode(e) {
  return typeof e.code === "string" ? e.code : undefined;
}

function utf8Encode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else cp = 0xfffd;
    } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  const n = bytes.length;
  const cont = (k) => (i + k < n && (bytes[i + k] & 0xc0) === 0x80 ? bytes[i + k] & 63 : -1);
  while (i < n) {
    const c = bytes[i];
    let cp = 0xfffd;
    let len = 1;
    if (c < 0x80) cp = c;
    else if ((c & 0xe0) === 0xc0) {
      const a = cont(1);
      if (a >= 0 && c >= 0xc2) {
        cp = ((c & 31) << 6) | a;
        len = 2;
      }
    } else if ((c & 0xf0) === 0xe0) {
      const a = cont(1), b = cont(2);
      if (a >= 0 && b >= 0) {
        const v = ((c & 15) << 12) | (a << 6) | b;
        if (v >= 0x800) {
          cp = v;
          len = 3;
        }
      }
    } else if ((c & 0xf8) === 0xf0) {
      const a = cont(1), b = cont(2), d = cont(3);
      if (a >= 0 && b >= 0 && d >= 0) {
        const v = ((c & 7) << 18) | (a << 12) | (b << 6) | d;
        if (v >= 0x10000 && v <= 0x10ffff) {
          cp = v;
          len = 4;
        }
      }
    }
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

module.exports = { delay, error, errorCode, utf8Encode, utf8Decode, now };
