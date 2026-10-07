/**
 * Which module declares each C and Objective-C type, from a scan of its
 * headers: cheap (no compiler), and enough to follow a referenced type to
 * the module, and so the artifact, that declares it.
 */
import fs from "node:fs";

/** Adds the types `headers` declare to `index` as `module`'s, unless an earlier module declared them. */
export function scanHeaders(
  index: Record<string, string>,
  module: string,
  headers: string[],
): void {
  for (const h of headers) {
    const text = fs.readFileSync(h, "utf8");
    const patterns = [
      // A class's own interface, not a category of it (`@interface NSString (UIKit)`).
      /@interface\s+(\w+)\b(?!\s*\()/g,
      /@protocol\s+(\w+)\s*[<\n]/g,
      /\b(?:NS|CF)_(?:ENUM|OPTIONS|CLOSED_ENUM|ERROR_ENUM)\s*\(\s*[\w\s]+,\s*(\w+)\s*\)/g,
      // Tagged definitions (`struct NS_SWIFT_SENDABLE _NSRange {`), whose tag is the USR's name.
      /\b(?:struct|union|enum)\s+(?:[A-Z][A-Z0-9_]*(?:\([^)]*\))?\s+)*(\w+)\s*\{/g,
    ];
    for (const re of patterns) for (const m of text.matchAll(re)) index[m[1]!] ??= module;
    for (const name of typedefNames(text)) index[name] ??= module;
  }
}

/** Macros around a declaration: `API_AVAILABLE(…)`, `CF_SWIFT_NONSENDABLE`, `__attribute__((…))`. */
const MACRO = /^_*[A-Z][A-Z0-9]*_[A-Z0-9_]*$|^__\w+__$/;

/**
 * The names a header's typedefs declare, whatever surrounds them: bodies,
 * attributes and availability after the name, bridging macros before it.
 */
function typedefNames(header: string): string[] {
  const code = header.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|^\s*#.*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(/\btypedef\b/g)) {
    let depth = 0;
    let end = m.index + "typedef".length;
    let body = end;
    for (; end < code.length; end++) {
      const c = code[end];
      if (c === "{" || c === "(") depth++;
      else if (c === "}" || c === ")") {
        depth--;
        if (c === "}" && depth === 0) body = end + 1;
      } else if (c === ";" && depth === 0) break;
    }
    const decl = code.slice(body, end);
    // Function pointers and blocks name themselves inside parentheses.
    const fn = /\(\s*[*^]\s*(?:_\w+\s+)*(\w+)\s*\)/.exec(decl);
    if (fn) {
      out.push(fn[1]!);
      continue;
    }
    let bare = decl;
    for (let prev = ""; prev !== bare;)
      [prev, bare] = [bare, bare.replace(/\w+\s*\([^()]*\)/g, " ")];
    const name = [...bare.matchAll(/\w+/g)]
      .map((t) => t[0])
      .filter((t) => !MACRO.test(t))
      .at(-1);
    if (name && /^[A-Za-z_]/.test(name)) out.push(name);
  }
  return out;
}

/**
 * The module a USR's declaration comes from: a Swift USR names it; a
 * clang one is the module whose symbol graph declares it, where one read
 * says (`graphs`), else looked up in the headers' index.
 */
export function ownerOf(
  usr: string,
  headers: Record<string, string>,
  graphs: Readonly<Record<string, string>> = {},
): string | undefined {
  if (Object.hasOwn(graphs, usr)) return graphs[usr];
  const swift = /^s:(\d+)/.exec(usr);
  if (swift) return usr.slice(swift[0].length, swift[0].length + Number(swift[1]));
  const name = /^c:(?:objc\((?:cs|pl)\)|.*@(?:[ETS]|EA|SA)@)(\w+)$/.exec(usr)?.[1];
  return name ? headers[name] : undefined;
}
