/**
 * The Swift names C functions are imported under (TA33): Swift makes
 * `CGImageGetWidth` the property `CGImage.width`, and
 * `CGImageCreateWithImageInRect` the method `CGImage.cropping(to:)`, as a
 * module's API notes or its headers' `swift_name` attributes say. The
 * name also says where the object (`self`) goes among the C arguments.
 */
import fs from "node:fs";
import path from "node:path";

/** C function name → the Swift name it is imported under, from the files in `dirs`. */
export function cSwiftNames(dirs: string[]): Map<string, string> {
  const out = new Map<string, string>();

  for (const dir of dirs) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

    // Headers' attributes first: API notes override them, as Clang reads them.
    for (const f of files.filter((x) => x.endsWith(".h")))
      for (const [name, swift] of attributeNames(fs.readFileSync(path.join(dir, f), "utf8")))
        out.set(name, swift);

    for (const f of files.filter((x) => x.endsWith(".apinotes")))
      for (const [name, swift] of apiNoteNames(fs.readFileSync(path.join(dir, f), "utf8")))
        out.set(name, swift);
  }

  return out;
}

/** The functions an API notes file names, and their SwiftName. */
function apiNoteNames(text: string): [string, string][] {
  const out: [string, string][] = [];
  const items = text.split(/^\s*- (?=Name:)/m).slice(1);

  for (const item of items) {
    const name = /^Name:\s*(\w+)/.exec(item)?.[1];
    // The item's own keys: up to the next item (or section) at its level.
    const own = item.split(/\n(?=\S|\s*- )/)[0]!;
    const swift = /^\s*SwiftName:\s*'?([^'\n]+?)'?\s*$/m.exec(own)?.[1];
    if (name && swift) out.push([name, swift]);
  }

  return out;
}

/** Functions declared with a `swift_name` attribute (`CF_SWIFT_NAME(…)`, `NS_SWIFT_NAME(…)`). */
function attributeNames(text: string): [string, string][] {
  const out: [string, string][] = [];
  const attribute = /\b(?:CF|NS|CG)_SWIFT_NAME\(([^()]*\([^()]*\))\)|swift_name\("([^"]+)"\)/g;

  for (const m of text.matchAll(attribute)) {
    const swift = m[1] ?? m[2]!;
    // The declaration it ends: from the end of the previous one.
    const before = text.slice(0, m.index);
    const start = Math.max(before.lastIndexOf(";"), before.lastIndexOf("}")) + 1;
    const name = /\b(\w+)\s*\(/.exec(before.slice(start))?.[1];
    if (name) out.push([name, swift]);
  }

  return out;
}

/** What a C function's Swift name makes it: a getter, a setter, a method or an initializer of `type`. */
export interface SwiftMember {
  kind: "getter" | "setter" | "method" | "init";
  type: string;
  name: string;
  /** Where the object goes among the C arguments; none for an initializer or a static member. */
  self?: number;
}

/** A Swift name's member (`getter:CGImage.width(self:)`); undefined for a top-level function's. */
export function swiftMemberOf(swift: string): SwiftMember | undefined {
  const m = /^(?:(getter|setter):)?([\w.]+)\.(\w+)\(([^)]*)\)$/.exec(swift);
  if (!m) return undefined;

  const [, accessor, type, name, args] = m;
  const labels = args!.split(":").filter((l) => l !== "");
  const self = labels.indexOf("self");
  const kind =
    accessor === "getter" || accessor === "setter" ? accessor : name === "init" ? "init" : "method";

  return { kind, type: type!, name: name!, ...(self >= 0 ? { self } : {}) };
}
