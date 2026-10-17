/**
 * The platform names Lucent's own code says (T152): every framework,
 * class and package name in the compiler, the bindings, the runtime and
 * the build logic, where it is said. The no-catalog audit
 * (platform-names.test.ts) holds each to the fixed platform anchors of
 * docs/design/contracts.md: a name no anchor covers is the start of a
 * list of SDKs, classes or packages that behavior depends on.
 *
 * What it finds: Apple's names by their frameworks' prefixes (`UI…`,
 * `NS…`), JVM names qualified or as descriptors, React Native's and Expo's
 * packages, and `facebook::` C++ names, in code and strings. Not in
 * comments, imports (a module's dependencies), Lucent's own names or the
 * diagnostics' explanations.
 *
 *   node scripts/platform-names.ts      # every name, the files saying it, and the audit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Lucent's behavior is written: the compiler, the bindings, the runtime and the build logic. */
export const SCANNED = [
  "packages/compiler/src",
  "packages/compiler/lib/sdk",
  "packages/codegen/src",
  "packages/bindgen/src",
  "packages/runtime/cpp/lucent",
  "packages/runtime/cpp/rn",
  "packages/runtime/native",
  "packages/runtime/js",
  "packages/lucent/src",
  "packages/lucent/metro",
  "packages/lucent/autolink",
  "packages/lucent/gradle",
  "packages/lucent/cocoapods",
  "packages/lucent/ts-plugin",
];

/**
 * What is scanned but says no behavior: the diagnostics' explanations,
 * whose examples are documentation (the website shows them), and code
 * vendored from elsewhere.
 */
export const NOT_SCANNED = [
  "packages/compiler/src/codes.ts",
  "third_party",
  "generated",
  "node_modules",
];

const SOURCE =
  /\.(ts|tsx|mts|cts|js|cjs|mjs|h|hpp|c|cc|cpp|m|mm|swift|kt|java|gradle|kts|rb|podspec|cmake)$/;
const SCRIPT = /\.(ts|tsx|mts|cts|js|cjs|mjs)$/;

/** Apple's class, type and function names: a framework's prefix, then a capitalized word. */
const APPLE =
  /\b(?:NS|UI|CF|CG|CA|CL|LA|PH|UN|BG|WK|MK|AV|CV|VN|SK|GK|HK|CK|MT|CI|AR|RCT)[A-Z][a-z][A-Za-z0-9]*\b/g;

/** A framework a module or header names: `<UIKit/UIKit.h>`, `@import UIKit;`, Swift's `import UIKit`, `lucent:ios/UIKit`, `-framework UIKit`. */
const FRAMEWORK =
  /<([A-Z][A-Za-z0-9]+)\/\1\.h>|@import ([A-Z][A-Za-z0-9]+)\s*;|^\s*import ([A-Z][A-Za-z0-9]+)\s*$|lucent:ios\/([A-Z][A-Za-z0-9]+)|-framework ([A-Z][A-Za-z0-9]+)/gm;

/**
 * A JVM class, qualified: its package, then a class (`android.view.View`,
 * `java/lang/String`, `android.os.Build$VERSION`, `kotlin.Int`), or a type
 * descriptor (`Landroidx/annotation/NonNull;`).
 */
const JVM_CLASS =
  /(?<![\w$./])L([a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*\/[A-Z][\w$]*);|(?<![\w$./])((?:kotlin|[a-z][a-z0-9_]*(?:[./][a-z][a-z0-9_]*)+)[./][A-Z]\w*(?:[.$][A-Z]\w*)*)/g;

/** What follows a file's name: its extension (`.txt` of `android/CMakeLists.txt`). */
const FILE =
  /^\.(?:txt|h|hpp|c|cc|cpp|m|mm|swift|java|kt|kts|gradle|xml|json|ya?ml|ts|js|cjs|mjs|cmake|pro|so|aar|jar|xcframework|framework|plist|resolved|podspec|rb|md|png|lucent|pbxproj|xcconfig|entitlements|properties)\b/;

/** A JVM package of the platform's, as a whole string: `"androidx.compose.ui"`. */
const JVM_PACKAGE =
  /^(?:android|androidx|java|javax|kotlin|kotlinx|dalvik|libcore|org\.jetbrains|com\.facebook|com\.google\.android)(?:\.[a-z][a-z0-9_]*)+$/;

/** Lucent's own names, which no platform gives: `dev.lucent.*`, its LucentNative and LucentExtensions modules, its TurboModule. */
const OWN = /^(?:dev\.lucent\.|Lucent|facebook::react::Lucent)/;

/** lucent.json's fields, as its schema has them (`android.resources`): not JVM packages. */
const FIELDS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  type Schema = { properties?: Record<string, Schema>; items?: Schema };
  const walk = (s: Schema, at: string) => {
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      out.add(at ? `${at}.${k}` : k);
      walk(v, at ? `${at}.${k}` : k);
    }
    if (s.items) walk(s.items, at);
  };
  walk(
    JSON.parse(
      fs.readFileSync(path.join(root, "packages/lucent/schemas/lucent.schema.json"), "utf8"),
    ) as Schema,
    "",
  );
  return out;
})();

/** An npm package of React Native's or Expo's, as a string or the start of one (`react-native/Libraries/…`). */
const NPM =
  /^(?:@react-native(?:-community)?\/[\w.-]+|@expo\/[\w.-]+|react-native(?:-[a-z][\w-]*)?|expo(?:-[a-z][\w-]*)?|react-dom|react)(?=$|\/)/;

/** React Native's and JSI's C++: `facebook::react::ShadowNode`, `facebook::jsi::Runtime`. */
const RN_CXX = /\bfacebook::(?:react|jsi|hermes)(?:::[A-Za-z_]\w*)+/g;

export type NameKind = "apple" | "framework" | "jvm" | "npm" | "react-native";

/** Each name found, by kind, and the files (repository-relative) that say it. */
export type Found = Map<string, { kind: NameKind; files: Set<string> }>;

function note(found: Found, kind: NameKind, name: string, file: string): void {
  if (OWN.test(name)) return;
  const key = `${kind}:${name}`;
  const entry = found.get(key) ?? { kind, files: new Set<string>() };
  entry.files.add(file);
  found.set(key, entry);
}

/**
 * A script's strings, as TypeScript parses them: string literals, template
 * texts, and regular expressions' patterns (a pattern names what it matches).
 * Not what it imports, whose names are its own dependencies (its
 * package.json's), not names behavior depends on.
 */
function scriptStrings(text: string, file: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const out: string[] = [];
  const imported = ({ parent }: ts.Node) =>
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword);

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      if (!imported(node)) out.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      out.push(node.text);
    else if (ts.isRegularExpressionLiteral(node))
      out.push(node.text.slice(1, node.text.lastIndexOf("/")).replace(/\\([/.$])/g, "$1"));
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return out;
}

/**
 * `text` without its comments, which name no behavior: a script's
 * identifiers and strings (TypeScript's parse), a native source with its
 * comments blanked.
 */
function uncommented(text: string, file: string): string {
  if (SCRIPT.test(file)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file));
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) out.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return [...out, ...scriptStrings(text, file)].join("\n");
  }

  // Native sources: // and /* */ comments outside strings, and Ruby's and CMake's #.
  return text
    .replace(/"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
      m.startsWith('"') ? m : " ",
    )
    .replace(/^\s*#(?!import|include|if|endif|else|elif|define|pragma|undef)[^\n]*/gm, " ");
}

const scriptKind = (file: string) =>
  /\.(js|cjs|mjs)$/.test(file)
    ? ts.ScriptKind.JS
    : file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;

/** A native source's double-quoted strings. */
function nativeStrings(text: string): string[] {
  return [...text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!);
}

/** The names `text` (of `file`) says. */
export function namesIn(text: string, file: string, found: Found = new Map()): Found {
  const strings = SCRIPT.test(file) ? scriptStrings(text, file) : nativeStrings(text);

  // Apple's names and frameworks, wherever code or strings say them: not comments.
  const code = uncommented(text, file);
  for (const m of code.matchAll(APPLE)) note(found, "apple", m[0], file);
  for (const m of code.matchAll(FRAMEWORK))
    note(found, "framework", m.slice(1).find(Boolean)!, file);
  for (const m of code.matchAll(RN_CXX)) note(found, "react-native", m[0], file);

  // JVM classes: in strings, and in Java and Kotlin code (imports, types).
  const jvmText = /\.(java|kt|kts|gradle)$/.test(file) ? [code] : strings;
  for (const s of jvmText)
    for (const m of s.matchAll(JVM_CLASS)) {
      // A file's path (`android/CMakeLists.txt`), not a class.
      if (FILE.test(s.slice(m.index + m[0].length))) continue;
      note(found, "jvm", (m[1] ?? m[2])!.replace(/[/$]/g, "."), file);
    }

  for (const s of strings) {
    if (JVM_PACKAGE.test(s) && !FIELDS.has(s) && !FILE.test(s.slice(s.lastIndexOf("."))))
      note(found, "jvm", s, file);
    const npm = NPM.exec(s);
    if (npm) note(found, "npm", npm[0], file);
  }

  return found;
}

/** Every name Lucent's own code says. */
export function platformNames(): Found {
  const found: Found = new Map();
  const skipped = (rel: string) => NOT_SCANNED.some((n) => rel === n || rel.split("/").includes(n));

  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    if (skipped(rel) || !fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, e));
      return;
    }
    if (SOURCE.test(rel)) namesIn(fs.readFileSync(abs, "utf8"), rel, found);
  };
  for (const d of SCANNED) walk(d);

  return found;
}

// --- the anchors ------------------------------------------------------------------------------

/** The contracts' file, whose "Fixed platform anchors" table lists the anchors. */
export const CONTRACTS = "docs/design/contracts.md";

/** What an anchor is: see the table's text. */
export const KINDS = ["language", "ABI", "platform", "example"] as const;

/** A row of the table: its names and where they are said (under packages/), as globs. */
export interface Anchor {
  names: string[];
  where: string[];
  kind: string;
  /** Its line in the contracts' file. */
  line: number;
}

/** The anchors table's rows: Names | Where | Kind | Why, each name and place in backticks. */
export function anchors(markdown = fs.readFileSync(path.join(root, CONTRACTS), "utf8")): Anchor[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf("## Fixed platform anchors");
  if (start < 0) throw new Error(`${CONTRACTS} has no "## Fixed platform anchors" section`);

  const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const out: Anchor[] = [];
  for (let i = start + 1; i < lines.length && !lines[i]!.startsWith("## "); i++) {
    const cells = lines[i]!.split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 4 || /^-+$/.test(cells[0]!) || cells[0] === "Names") continue;
    out.push({ names: ticked(cells[0]!), where: ticked(cells[1]!), kind: cells[2]!, line: i + 1 });
  }
  return out;
}

const escaped = (s: string) => s.replace(/[.+?^$()[\]\\|{}]/g, "\\$&");

/** A name's glob: `*` is anything (`kotlin.collections.*`, `UIScene*`). */
const nameGlob = (glob: string) => new RegExp(`^${glob.split("*").map(escaped).join(".*")}$`);

/** A path's glob: `*` within a directory, `**` across them, `{a,b}` either. */
function pathGlob(glob: string): RegExp {
  let re = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "{") {
      re += "(?:";
      depth++;
    } else if (c === "}" && depth) {
      re += ")";
      depth--;
    } else if (c === "," && depth) re += "|";
    else re += escaped(c);
  }
  return new RegExp(`^${re}$`);
}

/**
 * The audit: each name said in a file no anchor covers (`name in file`),
 * and each anchor's name or place that covers nothing, so the table says
 * what the code does.
 */
export function audit(found: Found, rows: Anchor[]): { uncovered: string[]; stale: string[] } {
  const compiled = rows.map((r) => ({
    names: r.names.map(nameGlob),
    where: r.where.map(pathGlob),
    usedNames: r.names.map(() => false),
    usedWhere: r.where.map(() => false),
  }));
  const pairs = new Set<string>();
  for (const [key, { files }] of found)
    for (const file of files)
      pairs.add(`${key.slice(key.indexOf(":") + 1)}\0${file.replace(/^packages\//, "")}`);

  const uncovered: string[] = [];
  for (const pair of [...pairs].sort()) {
    const [name, file] = pair.split("\0") as [string, string];
    let covered = false;
    for (const row of compiled) {
      const names = row.names.map((re) => re.test(name));
      const where = row.where.map((re) => re.test(file));
      if (!names.some(Boolean) || !where.some(Boolean)) continue;
      covered = true;
      names.forEach((m, i) => (row.usedNames[i] ||= m));
      where.forEach((m, i) => (row.usedWhere[i] ||= m));
    }
    if (!covered) uncovered.push(`${name} in ${file}`);
  }

  const stale: string[] = [];
  rows.forEach((r, i) => {
    const at = `${CONTRACTS}:${r.line}`;
    if (!(KINDS as readonly string[]).includes(r.kind))
      stale.push(`${at}: kind "${r.kind}" is none of ${KINDS.join(", ")}`);
    if (!r.names.length || !r.where.length)
      stale.push(`${at}: a row names its names and where they are`);
    r.names.forEach((n, j) => {
      if (!compiled[i]!.usedNames[j]) stale.push(`${at}: \`${n}\` is said in none of its places`);
    });
    r.where.forEach((w, j) => {
      if (!compiled[i]!.usedWhere[j]) stale.push(`${at}: \`${w}\` says none of its names`);
    });
  });

  return { uncovered, stale };
}

if (import.meta.main) {
  const found = platformNames();
  for (const [key, { files }] of [...found].sort(([a], [b]) => (a < b ? -1 : 1)))
    console.log(
      `${key}  ${[...files].slice(0, 3).join(", ")}${files.size > 3 ? ` +${files.size - 3}` : ""}`,
    );
  console.log(`${found.size} names`);

  const { uncovered, stale } = audit(found, anchors());
  for (const u of uncovered) console.log(`✗ no anchor covers ${u}`);
  for (const s of stale) console.log(`✗ ${s}`);
  if (uncovered.length || stale.length) process.exitCode = 1;
  else console.log(`✓ every name is a fixed platform anchor of ${CONTRACTS}`);
}
