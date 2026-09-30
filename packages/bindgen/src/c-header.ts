/**
 * The declarations of a C header, as clang reads them: its functions,
 * structs and typedefs, with every type resolved to what C means by it.
 * Only the header's own declarations are listed; the types they use may
 * come from anywhere it includes.
 *
 * Integer types are classified by the widest they are on a target Lucent
 * builds for (`long` and `size_t` are 64-bit on 64-bit iOS and Android), so
 * a declaration has one Lucent type everywhere.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** A C type. */
export type CType =
  | { k: "void" }
  | { k: "bool" }
  /** An integer type, by its C name after typedefs (`unsigned long`). */
  | { k: "int"; name: string; signed: boolean; bits: 8 | 16 | 32 | 64 }
  | { k: "float"; name: "float" | "double" }
  | { k: "enum"; name: string }
  /** `const` when what it points at is. */
  | { k: "pointer"; to: CType; const: boolean }
  /** A struct or union, by its tag (or its typedef's name when it has no tag). */
  | { k: "record"; name: string }
  | { k: "function" }
  | { k: "unknown"; spelling: string };

export interface CParam {
  /** Empty when the declaration names none. */
  name: string;
  type: CType;
}

export interface CFunction {
  name: string;
  params: CParam[];
  result: CType;
  variadic: boolean;
}

export interface CRecord {
  name: string;
  /** Declared only (`struct OrbitFilter;`): an opaque type. */
  complete: boolean;
  fields: CParam[];
  /** Typedef names that mean this record. */
  aliases: string[];
}

export interface CHeader {
  /** The header's own functions, in declaration order. */
  functions: CFunction[];
  /** Structs and unions the header declares or names. */
  records: CRecord[];
}

export interface CHeaderOptions {
  /** Directories searched for what the header includes (-I). */
  includePaths?: string[];
  /** The clang to run (default: findClang()). */
  clang?: string;
}

/** A node of clang's JSON AST, as far as this reads it. */
interface Node {
  id?: string;
  kind?: string;
  name?: string;
  type?: { qualType?: string; desugaredQualType?: string };
  inner?: Node[];
  loc?: Location;
  range?: { begin?: Location; end?: Location };
  completeDefinition?: boolean;
  variadic?: boolean;
  /** A LinkageSpecDecl's: `C` for `extern "C"`. */
  language?: string;
  decl?: { id?: string; kind?: string; name?: string };
  ownedTagDecl?: { id?: string };
}

interface Location {
  file?: string;
  spellingLoc?: Location;
  expansionLoc?: Location;
}

/** The C integer types, by name, and the widest they are on a target Lucent builds for. */
const INTEGERS: Record<string, { signed: boolean; bits: 8 | 16 | 32 | 64 }> = {
  char: { signed: true, bits: 8 },
  "signed char": { signed: true, bits: 8 },
  "unsigned char": { signed: false, bits: 8 },
  short: { signed: true, bits: 16 },
  "unsigned short": { signed: false, bits: 16 },
  int: { signed: true, bits: 32 },
  "unsigned int": { signed: false, bits: 32 },
  long: { signed: true, bits: 64 },
  "unsigned long": { signed: false, bits: 64 },
  "long long": { signed: true, bits: 64 },
  "unsigned long long": { signed: false, bits: 64 },
};

/** Spellings clang may print that name the same integer type. */
const SYNONYMS: Record<string, string> = {
  "short int": "short",
  "signed short": "short",
  "unsigned short int": "unsigned short",
  signed: "int",
  "signed int": "int",
  unsigned: "unsigned int",
  "long int": "long",
  "signed long": "long",
  "unsigned long int": "unsigned long",
  "long long int": "long long",
  "signed long long": "long long",
  "unsigned long long int": "unsigned long long",
};

/** Qualifiers and nullability annotations that do not change what a type is. */
const IGNORED =
  /\b(?:volatile|restrict|__restrict|_Nullable|_Nonnull|_Null_unspecified|_Atomic)\b/g;

/** Runs clang over `header` and reads its declarations. Throws when clang is missing or fails. */
export function extractCHeader(header: string, opts: CHeaderOptions = {}): CHeader {
  const r = dumpAst(header, ["-x", "c", "-std=c11"], opts);
  if (!r.ok) throw new Error(`${path.basename(header)}: ${r.error}`);

  return readAst(r.unit, header);
}

/**
 * The header read as C++, as generated code includes it: the functions it
 * declares with C linkage (in `extern "C"`), or clang's error when it does
 * not compile as C++.
 */
export function cLinkage(
  header: string,
  opts: CHeaderOptions = {},
): { ok: true; functions: string[] } | { ok: false; error: string } {
  const r = dumpAst(header, ["-x", "c++", "-std=c++20"], opts);
  if (!r.ok) return r;

  const own = fs.realpathSync(header);
  const out: string[] = [];

  let file: string | undefined;
  const follow = followFiles((f) => (file = f));

  for (const node of r.unit.inner ?? []) {
    follow(node.loc);
    const mine = file !== undefined && sameFile(file, own);
    follow(node.range);

    if (mine && node.kind === "LinkageSpecDecl" && node.language === "C")
      for (const d of node.inner ?? []) if (d.kind === "FunctionDecl" && d.name) out.push(d.name);

    follow(node.inner);
  }

  return { ok: true, functions: out };
}

/** clang's JSON AST of `header` in `language`, or its errors. Throws when clang cannot run. */
function dumpAst(
  header: string,
  language: string[],
  opts: CHeaderOptions,
): { ok: true; unit: Node } | { ok: false; error: string } {
  const clang = opts.clang ?? findClang();
  const args = [
    ...language,
    "-fsyntax-only",
    "-Xclang",
    "-ast-dump=json",
    ...(opts.includePaths ?? []).flatMap((i) => ["-I", i]),
    header,
  ];

  const r = spawnSync(clang, args, { encoding: "utf8", maxBuffer: 256 << 20 });

  if (r.error)
    throw new Error(
      `${clang} could not run (${r.error.message}): reading a C header needs clang; set LUCENT_CLANG to its path`,
    );
  if (r.status !== 0) return { ok: false, error: r.stderr.trim() };

  return { ok: true, unit: JSON.parse(r.stdout) as Node };
}

let clangFound: string | undefined;

/**
 * The clang to read headers with: $LUCENT_CLANG, else clang on the PATH,
 * else Xcode's, else the newest Android NDK's (a Linux host building
 * Android may have no other).
 */
export function findClang(): string {
  if (process.env.LUCENT_CLANG) return process.env.LUCENT_CLANG;
  if (clangFound) return clangFound;

  const works = (c: string) => spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0;
  const xcode = spawnSync("xcrun", ["--find", "clang"], { encoding: "utf8" });

  const ndks = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT]
    .concat(
      [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
        .filter((r): r is string => !!r && fs.existsSync(path.join(r, "ndk")))
        .flatMap((r) =>
          fs
            .readdirSync(path.join(r, "ndk"))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
            .map((v) => path.join(r, "ndk", v)),
        ),
    )
    .filter((d): d is string => !!d)
    .flatMap((ndk) => {
      const prebuilt = path.join(ndk, "toolchains/llvm/prebuilt");
      return fs.existsSync(prebuilt)
        ? fs.readdirSync(prebuilt).map((host) => path.join(prebuilt, host, "bin/clang"))
        : [];
    });

  const candidates = ["clang", ...(xcode.status === 0 ? [xcode.stdout.trim()] : []), ...ndks];

  clangFound = candidates.find(works) ?? "clang";
  return clangFound;
}

/** The declarations of `header` in clang's JSON AST of a translation unit. */
export function readAst(unit: Node, header: string): CHeader {
  const own = fs.realpathSync(header);
  const functions: Node[] = [];
  const typedefs = new Map<string, Node>();

  // Records by name (their tag, else the first typedef naming them), and the names of clang's ids.
  const records = new Map<string, { node?: Node; aliases: string[] }>();
  const names = new Map<string, string>();
  const untagged = new Map<string, Node>();

  const record = (name: string, node?: Node) => {
    const known = records.get(name) ?? { aliases: [] };

    // The definition, wherever it is: a declaration alone leaves the record opaque.
    if (node && (!known.node || node.completeDefinition)) known.node = node;

    records.set(name, known);
    return known;
  };

  let file: string | undefined;
  const follow = followFiles((f) => (file = f));

  for (const node of unit.inner ?? []) {
    follow(node.loc);
    const mine = file !== undefined && sameFile(file, own);
    follow(node.range);
    follow(node.inner);

    if (node.kind === "RecordDecl" && node.id) {
      if (node.name) {
        record(node.name, node);
        names.set(node.id, node.name);
      } else untagged.set(node.id, node);
    }

    if (node.kind === "TypedefDecl" && node.name) {
      typedefs.set(node.name, node);

      const target = recordOf(node);
      const named = target ? names.get(target) : undefined;

      if (named) record(named).aliases.push(node.name);
      else if (target && untagged.has(target)) {
        record(node.name, untagged.get(target)).aliases.push(node.name);
        names.set(target, node.name);
      }
    }

    if (node.kind === "FunctionDecl" && node.name && mine) functions.push(node);
  }

  const resolve = (spelling: string, seen = new Set<string>()): CType =>
    parseCType(spelling, (name) => {
      if (seen.has(name)) return undefined;

      const td = typedefs.get(name);
      if (!td) return undefined;

      const target = recordOf(td);
      const named = target ? names.get(target) : undefined;
      if (named) return { k: "record", name: named };

      // An untagged enum's typedef desugars to its own name: its spelling says `enum`.
      const under = [td.type?.desugaredQualType, td.type?.qualType].find((u) => u && u !== name);
      return resolve(under ?? "", new Set([...seen, name]));
    });

  const typeOf = (n: Node): CType => resolve(n.type?.desugaredQualType ?? n.type?.qualType ?? "");

  return {
    functions: functions.map((f) => {
      const params = (f.inner ?? []).filter((c) => c.kind === "ParmVarDecl");

      return {
        name: f.name!,
        params: params.map((p) => ({ name: p.name ?? "", type: typeOf(p) })),
        result: resolve(resultSpelling(f.type?.qualType ?? "")),
        variadic: !!f.variadic,
      };
    }),
    records: [...records].map(([name, { node, aliases }]) => ({
      name,
      complete: !!node?.completeDefinition,
      fields: (node?.inner ?? [])
        .filter((c) => c.kind === "FieldDecl")
        .map((c) => ({ name: c.name ?? "", type: typeOf(c) })),
      aliases: [...new Set(aliases)],
    })),
  };
}

/**
 * A walker that reports each location's file: clang prints it only where
 * it changes, so every location must be walked, in the order printed.
 */
function followFiles(seen: (file: string) => void): (v: unknown) => void {
  const follow = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(follow);
    if (typeof v !== "object" || v === null) return;

    const o = v as Record<string, unknown>;
    if (typeof o.file === "string" && ("offset" in o || "line" in o)) seen(o.file);

    for (const x of Object.values(o)) follow(x);
  };

  return follow;
}

function sameFile(a: string, b: string): boolean {
  if (a === b) return true;

  try {
    return fs.realpathSync(a) === b;
  } catch {
    return false;
  }
}

/**
 * The record a typedef names (`typedef struct X X;`, `typedef struct { … } X;`,
 * a typedef of such a typedef); none for a pointer to one or anything else.
 */
function recordOf(td: Node): string | undefined {
  // Sugar over the named type; a PointerType (or any other) names something else.
  const through = new Set(["ElaboratedType", "TypedefType", "QualType", "RecordType"]);

  const walk = (n: Node): string | undefined => {
    if (!through.has(n.kind ?? "")) return undefined;
    if (n.ownedTagDecl?.id) return n.ownedTagDecl.id;
    if (n.kind === "RecordType" && n.decl?.id) return n.decl.id;

    return (n.inner ?? []).map(walk).find((id) => id !== undefined);
  };

  return (td.inner ?? []).map(walk).find((id) => id !== undefined);
}

/** A function type's result: what precedes its parameter list (`OrbitFilter *(double)` → `OrbitFilter *`). */
function resultSpelling(fn: string): string {
  let depth = 0;

  for (let i = fn.length - 1; i >= 0; i--) {
    if (fn[i] === ")") depth++;
    else if (fn[i] === "(" && --depth === 0) return fn.slice(0, i).trim();
  }

  return fn;
}

/**
 * The C type a spelling names (`const uint8_t *`), following typedef
 * names through `typedef` (undefined: not a typedef).
 */
export function parseCType(
  spelling: string,
  typedef: (name: string) => CType | undefined = () => undefined,
): CType {
  const s = spelling
    .replace(/__attribute__\s*\(\(.*?\)\)/g, " ")
    .replace(IGNORED, " ")
    .replace(/\s+/g, " ")
    .trim();

  // An unnamed enum or struct: clang says where it is, in parentheses.
  if (/\((unnamed|anonymous) /.test(s)) return { k: "unknown", spelling: s };
  if (s.includes("(")) return { k: "function" };

  const parts = s.split("*");
  const base = parts[0]!.trim();
  const isConst = /\bconst\b/.test(base);
  const name = base
    .replace(/\bconst\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let t = baseType(name, typedef);

  for (let i = 1; i < parts.length; i++)
    t = { k: "pointer", to: t, const: i === 1 ? isConst : /\bconst\b/.test(parts[i - 1]!) };

  return t;
}

function baseType(name: string, typedef: (name: string) => CType | undefined): CType {
  if (name === "void") return { k: "void" };
  if (name === "_Bool" || name === "bool") return { k: "bool" };
  if (name === "float" || name === "double") return { k: "float", name };

  const integer = SYNONYMS[name] ?? name;
  if (INTEGERS[integer]) return { k: "int", name: integer, ...INTEGERS[integer] };

  const tagged = /^(struct|union|enum) (\w+)$/.exec(name);
  // A struct without a tag is printed with its typedef's name, which is how records are named too.
  if (tagged) return { k: tagged[1] === "enum" ? "enum" : "record", name: tagged[2]! };

  if (/^\w+$/.test(name)) return typedef(name) ?? { k: "unknown", spelling: name };

  return { k: "unknown", spelling: name };
}

/** A C type as C spells it, for messages: `const unsigned char *`. */
export function formatCType(t: CType): string {
  switch (t.k) {
    case "void":
      return "void";
    case "bool":
      return "bool";
    case "int":
    case "float":
      return t.name;
    case "enum":
      return `enum ${t.name}`;
    case "record":
      return t.name;
    case "function":
      return "a function pointer";
    case "unknown":
      return t.spelling;
    case "pointer":
      return `${t.const ? "const " : ""}${formatCType(t.to)} *`;
  }
}
