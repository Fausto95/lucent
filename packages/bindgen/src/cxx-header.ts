/**
 * The declarations of a C++ header (decision 0125), as clang reads it as
 * C++20: the classes and enums it defines in a named namespace or none,
 * each class's public constructors and member functions, and its
 * functions with C linkage, with their types resolved to what crosses
 * into Lucent. A class or member that can't be bound is kept with the
 * reason, for the declarations' list of what was left out.
 *
 * Types are read from clang's spellings, desugared where clang gives one:
 * `std::string` is any of the standard libraries' basic_string<char>, the
 * fixed-width integer typedefs are the integers they are on a target
 * Lucent builds for, and a name is an enum or class of the header's by its
 * qualified name, or its last part when that names one alone.
 */
import fs from "node:fs";
import path from "node:path";
import {
  type CFunction,
  type CHeaderOptions,
  type CRecord,
  type CType,
  dumpAst,
  followFiles,
  type Node,
  parseCType,
  resultSpelling,
  sameFile,
} from "./c-header.ts";

/** What a C++ type is to Lucent. */
export type CxxType =
  | { k: "void" }
  | { k: "bool" }
  /** An integer type, by its C name (`unsigned long`). */
  | { k: "int"; name: string; signed: boolean; bits: 8 | 16 | 32 | 64 }
  | { k: "float"; name: "float" | "double" }
  /** `std::string`, `std::string_view` or `const char *`, by value or `const &`. */
  | { k: "string"; of: "string" | "string_view" | "chars" }
  | { k: "vector"; of: CxxType }
  | { k: "optional"; of: CxxType }
  /** An enum of the header's, by its qualified name. */
  | { k: "enum"; name: string }
  /** A class of the header's, by its qualified name, and how it is passed. */
  | { k: "class"; name: string; by: "value" | "ref" | "constRef" | "pointer" | "constPointer" }
  /** A `std::function`, by value or `const &`: what it returns and takes. */
  | { k: "function"; result: CxxType; params: CxxType[] }
  | { k: "unknown"; spelling: string };

export interface CxxParam {
  /** Empty when the declaration names none. */
  name: string;
  type: CxxType;
  /** It has a default argument. */
  defaulted: boolean;
}

export interface CxxConstructor {
  params: CxxParam[];
}

export interface CxxMethod {
  name: string;
  params: CxxParam[];
  result: CxxType;
  const: boolean;
  static: boolean;
}

export interface CxxClass {
  /** Its own name, which Lucent code uses. */
  name: string;
  /** Its name in C++, from the global namespace: `acme::Counter`. */
  qualified: string;
  /** `struct` or `class`. */
  tag: string;
  constructors: CxxConstructor[];
  methods: CxxMethod[];
  /** Why it isn't bound at all (a template, a base), when it isn't. */
  refused?: string;
  /** Whether a value of it can be moved into a new one (a result by value is). */
  movable: boolean;
  /** Its members left out, `name: reason`. */
  skipped: string[];
}

export interface CxxEnum {
  name: string;
  qualified: string;
  scoped: boolean;
  values: { name: string; value: number }[];
}

export interface CxxHeader {
  classes: CxxClass[];
  enums: CxxEnum[];
  /** Its functions with C linkage, read as a C header's are. */
  functions: CFunction[];
  /** The structs C functions name, declared or defined at the top level: opaque handles, errors. */
  records: CRecord[];
  /** What else it declares that isn't bound, `name: reason`. */
  skipped: string[];
}

/** The fields of clang's JSON AST a C++ header's declarations have, beyond a C header's. */
interface CxxNode extends Node {
  inner?: CxxNode[];
  tagUsed?: string;
  isImplicit?: boolean;
  storageClass?: string;
  access?: string;
  pure?: boolean;
  explicitlyDeleted?: boolean;
  init?: string;
  value?: string;
  scopedEnumTag?: string;
  bases?: unknown[];
  definitionData?: { isAbstract?: boolean };
}

/** The fixed-width and size typedefs: the integers they are on a target Lucent builds for. */
const INTEGER_TYPEDEFS: Record<string, CxxType & { k: "int" }> = Object.fromEntries(
  (
    [
      ["int8_t", "signed char", true, 8],
      ["uint8_t", "unsigned char", false, 8],
      ["int16_t", "short", true, 16],
      ["uint16_t", "unsigned short", false, 16],
      ["int32_t", "int", true, 32],
      ["uint32_t", "unsigned int", false, 32],
      ["int64_t", "long long", true, 64],
      ["uint64_t", "unsigned long long", false, 64],
      ["size_t", "unsigned long", false, 64],
      ["ssize_t", "long", true, 64],
      ["intptr_t", "long", true, 64],
      ["uintptr_t", "unsigned long", false, 64],
      ["ptrdiff_t", "long", true, 64],
    ] as const
  ).flatMap(([typedef, name, signed, bits]) => {
    const t = { k: "int" as const, name, signed, bits };
    return [
      [typedef, t],
      [`std::${typedef}`, t],
    ];
  }),
);

/** Runs clang over `header`, read as C++20, and reads its declarations. Throws when it doesn't compile. */
export function extractCxxHeader(header: string, opts: CHeaderOptions = {}): CxxHeader {
  const r = dumpAst(header, ["-x", "c++", "-std=c++20"], opts);
  if (!r.ok) throw new Error(`${path.basename(header)}: ${r.error}`);

  return readCxxAst(r.unit as CxxNode, header);
}

/** A parsed spelling: a name (`std::vector`), its template arguments, and what wraps it. */
interface Spelled {
  name: string;
  args: Spelled[];
  const: boolean;
  /** Pointers and references after it, innermost first: `*`, `&`, `&&`. */
  wraps: string[];
  /** A function type's parameters (`void (double)`): the rest is what it returns. */
  params?: Spelled[];
  /** A pointer to that function type: `void (*)(double)`. */
  pointer?: boolean;
}

/** The declarations of `header` in clang's JSON AST of a C++ translation unit. */
export function readCxxAst(unit: CxxNode, header: string): CxxHeader {
  const own = fs.realpathSync(header);
  const classes: { node: CxxNode; qualified: string; refused?: string }[] = [];
  const enums: CxxEnum[] = [];
  const functions: CxxNode[] = [];
  const records = new Map<string, { node: CxxNode; aliases: string[] }>();
  const skipped: string[] = [];

  let file: string | undefined;
  const follow = followFiles((f) => (file = f));

  // The header's own declarations, by namespace; anonymous namespaces and other files are left out.
  const visit = (nodes: CxxNode[] | undefined, scope: string[], linkageC: boolean): void => {
    for (const node of nodes ?? []) {
      follow(node.loc);
      const mine = file !== undefined && sameFile(file, own);
      follow(node.range);

      const qualified = [...scope, node.name ?? ""].join("::");

      if (node.kind === "NamespaceDecl") {
        if (node.name) visit(node.inner, [...scope, node.name], linkageC);
        else follow(node.inner);
        continue;
      }
      if (node.kind === "LinkageSpecDecl") {
        visit(node.inner, scope, node.language === "C");
        continue;
      }

      follow(node.inner);

      // A struct at the top level, wherever it is declared, and its definition: C's records.
      if (node.kind === "CXXRecordDecl" && node.name && scope.length === 0) {
        const known = records.get(node.name);
        if (!known || node.completeDefinition)
          records.set(node.name, { node, aliases: known?.aliases ?? [] });
      }
      if (node.kind === "TypedefDecl" && node.name && scope.length === 0) {
        const target = /^(?:struct |class )?(\w+)$/.exec(
          node.type?.desugaredQualType ?? node.type?.qualType ?? "",
        )?.[1];
        if (target && target !== node.name) records.get(target)?.aliases.push(node.name);
      }

      if (!mine || !node.name) continue;

      if (node.kind === "CXXRecordDecl" && node.completeDefinition && node.tagUsed !== "union")
        classes.push({ node, qualified });
      else if (node.kind === "ClassTemplateDecl")
        skipped.push(`${node.name}: a class template, which Lucent doesn't bind`);
      else if (node.kind === "EnumDecl") enums.push(enumOf(node, qualified));
      else if (node.kind === "FunctionDecl") {
        if (linkageC && scope.length === 0) functions.push(node);
        else skipped.push(`${node.name}: a C++ function; Lucent binds classes and C functions`);
      }
    }
  };
  visit(unit.inner, [], false);

  // A name the header's classes and enums have alone, besides their qualified names.
  const named = new Map<string, string | null>();
  const name = (short: string, qualified: string) =>
    named.set(short, named.has(short) && named.get(short) !== qualified ? null : qualified);
  for (const c of classes) name(c.node.name!, c.qualified);
  for (const e of enums) name(e.name, e.qualified);
  const enumNames = new Set(enums.map((e) => e.qualified));
  const classNames = new Set(classes.map((c) => c.qualified));
  const resolve = (n: string): string | undefined => {
    const bare = n.replace(/^::/, "");
    if (enumNames.has(bare) || classNames.has(bare)) return bare;
    const at = bare.lastIndexOf("::");
    const last = at < 0 ? bare : bare.slice(at + 2);
    return named.get(bare) ?? named.get(last) ?? undefined;
  };

  const typeOf = (spelling: string, desugared?: string): CxxType => {
    const written = cxxType(parseSpelling(spelling), resolve, enumNames);
    if (written.k !== "unknown" || !desugared) return written;
    return cxxType(parseSpelling(desugared), resolve, enumNames);
  };

  return {
    classes: classes.map((c) => classOf(c.node, c.qualified, typeOf)),
    enums,
    functions: functions.map((f) => ({
      name: f.name!,
      params: (f.inner ?? [])
        .filter((p) => p.kind === "ParmVarDecl")
        .map((p) => ({
          name: p.name ?? "",
          type: parseCType(p.type?.desugaredQualType ?? p.type?.qualType ?? ""),
        })),
      result: parseCType(resultSpelling(f.type?.qualType ?? "")) as CType,
      variadic: !!f.variadic,
    })),
    records: [...records].map(([name, { node, aliases }]) => ({
      name,
      complete: !!node.completeDefinition,
      fields: (node.inner ?? [])
        .filter((c) => c.kind === "FieldDecl")
        .map((c) => ({
          name: c.name ?? "",
          type: parseCType(c.type?.desugaredQualType ?? c.type?.qualType ?? ""),
        })),
      aliases,
    })),
    skipped,
  };
}

function enumOf(node: CxxNode, qualified: string): CxxEnum {
  let next = 0;
  const values = (node.inner ?? [])
    .filter((c) => c.kind === "EnumConstantDecl")
    .map((c) => {
      const given = (c.inner ?? []).find((x) => x.kind === "ConstantExpr")?.value;
      const value = given !== undefined ? Number(given) : next;
      next = value + 1;
      return { name: c.name!, value };
    });

  return { name: node.name!, qualified, scoped: !!node.scopedEnumTag, values };
}

function classOf(
  node: CxxNode,
  qualified: string,
  typeOf: (spelling: string, desugared?: string) => CxxType,
): CxxClass {
  const base = {
    name: node.name!,
    qualified,
    tag: node.tagUsed ?? "class",
    constructors: [] as CxxConstructor[],
    methods: [] as CxxMethod[],
    skipped: [] as string[],
    movable: movable(node),
  };

  if (node.bases?.length) return { ...base, refused: "it has a base class" };
  if (node.definitionData?.isAbstract) return { ...base, refused: "it is abstract" };

  let access = node.tagUsed === "struct" ? "public" : "private";
  const params = (n: CxxNode): CxxParam[] =>
    (n.inner ?? [])
      .filter((p) => p.kind === "ParmVarDecl")
      .map((p) => ({
        name: p.name ?? "",
        type: typeOf(p.type?.qualType ?? "", p.type?.desugaredQualType),
        defaulted: p.init !== undefined,
      }));
  const self = (t: CxxType) => t.k === "class" && t.name === qualified;

  for (const m of node.inner ?? []) {
    if (m.kind === "AccessSpecDecl") {
      access = m.access ?? access;
      continue;
    }
    if (access !== "public" || m.isImplicit || !m.name) continue;

    const skip = (why: string) => base.skipped.push(`${m.name}: ${why}`);

    if (m.kind === "FunctionTemplateDecl") skip("a member template");
    else if (m.explicitlyDeleted) continue;
    else if (m.kind === "CXXConstructorDecl") {
      const ps = params(m);
      // Copies and moves are C++'s: a handle is its object.
      const copies =
        ps.length === 1 &&
        self(ps[0]!.type) &&
        ps[0]!.type.k === "class" &&
        ps[0]!.type.by !== "pointer";
      if (!copies && !/\(.*&&.*\)/.test(m.type?.qualType ?? ""))
        base.constructors.push({ params: ps });
    } else if (m.kind === "CXXMethodDecl") {
      if (m.name.startsWith("operator")) continue;
      const signature = m.type?.qualType ?? "";
      base.methods.push({
        name: m.name,
        params: params(m),
        result: typeOf(resultSpelling(signature)),
        const: /\)\s*const\b/.test(signature),
        static: m.storageClass === "static",
      });
    }
  }

  return base;
}

/**
 * Whether a value of the class can be moved (or copied) into a new one:
 * not when it deletes its move constructor, or deletes its copy
 * constructor and declares no move constructor.
 */
function movable(node: CxxNode): boolean {
  const name = node.name!;
  const ctors = (node.inner ?? []).filter((m) => m.kind === "CXXConstructorDecl");
  const takes = (m: CxxNode, re: RegExp) => re.test(m.type?.qualType ?? "");
  const move = new RegExp(`^void \\((?:\\w+::)*${name} &&\\)$`);
  const copy = new RegExp(`^void \\(const (?:\\w+::)*${name} &\\)$`);
  const moves = ctors.filter((m) => takes(m, move));
  const copies = ctors.filter((m) => takes(m, copy));

  if (moves.some((m) => m.explicitlyDeleted)) return false;
  if (moves.length) return true;
  return !copies.some((m) => m.explicitlyDeleted);
}

/** A C++ spelling, parsed: `const std::vector<int> &`. */
export function parseSpelling(spelling: string): Spelled {
  const s = spelling.replace(/\s+/g, " ").trim();
  let i = 0;

  const ws = () => {
    while (s[i] === " ") i++;
  };
  const word = (): string => {
    ws();
    const m = /^(?:::)?[A-Za-z_][\w]*(?:::[A-Za-z_][\w]*)*/.exec(s.slice(i));
    if (!m) return "";
    i += m[0].length;
    return m[0];
  };
  const type = (): Spelled => {
    let isConst = false;
    const words: string[] = [];
    for (;;) {
      const w = word();
      if (!w) break;
      if (w === "const") isConst = true;
      else if (w === "volatile" || w === "struct" || w === "class" || w === "enum") continue;
      else words.push(w);
      ws();
      if (s[i] === "<") break;
    }
    const args: Spelled[] = [];
    ws();
    if (s[i] === "<") {
      i++;
      for (;;) {
        ws();
        if (s[i] === ">") {
          i++;
          break;
        }
        args.push(type());
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === ">") {
          i++;
          break;
        } else if (i >= s.length) break;
      }
    }
    const wraps: string[] = [];
    for (;;) {
      ws();
      if (s.startsWith("&&", i)) {
        wraps.push("&&");
        i += 2;
      } else if (s[i] === "&" || s[i] === "*") wraps.push(s[i++]!);
      else if (s.startsWith("const", i) && !/\w/.test(s[i + 5] ?? "")) {
        // `T *const`: the pointer itself is const, which changes nothing that crosses.
        i += 5;
        if (!wraps.length) isConst = true;
      } else break;
    }
    // A function type, as a template argument spells one (`void (double, int)`), or a pointer to one.
    ws();
    let pointer = false;
    if (/^\(\s*\*\s*\)\s*\(/.test(s.slice(i))) {
      pointer = true;
      i = s.indexOf("(", s.indexOf(")", i));
    }
    if (s[i] === "(") {
      i++;
      const params: Spelled[] = [];
      for (;;) {
        ws();
        if (s[i] === ")" || i >= s.length) {
          i++;
          break;
        }
        params.push(type());
        ws();
        if (s[i] === ",") i++;
      }
      const none = params.length === 1 && params[0]!.name === "void" && !params[0]!.wraps.length;
      return {
        name: words.join(" "),
        args,
        const: isConst,
        wraps,
        params: none ? [] : params,
        ...(pointer ? { pointer } : {}),
      };
    }
    return { name: words.join(" "), args, const: isConst, wraps };
  };

  return type();
}

/** The fundamental types, by C++'s spellings. */
const FUNDAMENTAL: Record<string, CxxType> = {
  void: { k: "void" },
  bool: { k: "bool" },
  float: { k: "float", name: "float" },
  double: { k: "float", name: "double" },
};

const STD = /^(?:::)?std::(?:__1::|__cxx11::)?/;

/** What spelling `t` is to Lucent: unknown for what no rule reads. */
function cxxType(
  t: Spelled,
  resolve: (name: string) => string | undefined,
  enums: ReadonlySet<string>,
): CxxType {
  const unknown = (): CxxType => ({ k: "unknown", spelling: format(t) });
  // A function type or a pointer to one: only a std::function's argument is read.
  if (t.params) return unknown();
  const plain = t.wraps.length === 0;
  const constRef = t.const && t.wraps.length === 1 && t.wraps[0] === "&";
  const name = t.name.replace(/^::/, "");
  const std = STD.test(name) ? name.replace(STD, "") : undefined;
  const of = (i: number) => cxxType(t.args[i]!, resolve, enums);

  // `const char *`: a string read for the call.
  if (name === "char" && t.const && t.wraps.length === 1 && t.wraps[0] === "*")
    return { k: "string", of: "chars" };

  if (std === "string" || (std === "basic_string" && format(t.args[0]) === "char"))
    return plain || constRef ? { k: "string", of: "string" } : unknown();
  if (std === "string_view" || (std === "basic_string_view" && format(t.args[0]) === "char"))
    return plain || constRef ? { k: "string", of: "string_view" } : unknown();
  if (std === "vector" && t.args.length >= 1 && (plain || constRef)) {
    const element = of(0);
    return element.k === "int" ||
      element.k === "float" ||
      element.k === "bool" ||
      (element.k === "string" && element.of !== "chars")
      ? { k: "vector", of: element }
      : unknown();
  }
  if (std === "function" && t.args.length === 1 && t.args[0]!.params && (plain || constRef)) {
    const { params, pointer, ...result } = t.args[0]!;
    if (pointer) return unknown();
    return {
      k: "function",
      result: cxxType(result, resolve, enums),
      params: params!.map((p) => cxxType(p, resolve, enums)),
    };
  }
  if (std === "optional" && t.args.length === 1 && (plain || constRef)) {
    const inner = of(0);
    return inner.k === "unknown" || inner.k === "void" || inner.k === "optional"
      ? unknown()
      : { k: "optional", of: inner };
  }

  if (!plain && !constRef) {
    // A class by reference or pointer: its handle's object.
    const target = resolve(name);
    if (target && !enums.has(target) && !t.args.length && t.wraps.length === 1) {
      const w = t.wraps[0];
      if (w === "&") return { k: "class", name: target, by: t.const ? "constRef" : "ref" };
      if (w === "*") return { k: "class", name: target, by: t.const ? "constPointer" : "pointer" };
    }
    return unknown();
  }

  const fundamental = FUNDAMENTAL[name];
  if (fundamental) return plain ? fundamental : unknown();

  const integer = INTEGER_TYPEDEFS[name] ?? cInteger(name);
  if (integer) return plain || constRef ? integer : unknown();

  const target = resolve(name);
  if (target && !t.args.length) {
    if (enums.has(target)) return plain || constRef ? { k: "enum", name: target } : unknown();
    return { k: "class", name: target, by: constRef ? "constRef" : "value" };
  }

  return unknown();
}

/** An integer type C spells (`unsigned long`), as a C header's is read. */
function cInteger(name: string): (CxxType & { k: "int" }) | undefined {
  const t = parseCType(name);
  return t.k === "int" ? t : undefined;
}

/** A spelling as C++ writes it, for messages. */
export function format(t: Spelled | undefined): string {
  if (!t) return "";
  const args = t.args.length ? `<${t.args.map(format).join(", ")}>` : "";
  const params = t.params ? `${t.pointer ? " (*)" : " "}(${t.params.map(format).join(", ")})` : "";
  return `${t.const ? "const " : ""}${t.name}${args}${t.wraps.length ? ` ${t.wraps.join("")}` : ""}${params}`;
}

/** A C++ type as Lucent reads it, for messages: `std::vector<double>`. */
export function formatCxxType(t: CxxType): string {
  switch (t.k) {
    case "void":
    case "bool":
      return t.k;
    case "int":
    case "float":
      return t.name;
    case "string":
      return t.of === "chars" ? "const char *" : `std::${t.of}`;
    case "vector":
      return `std::vector<${formatCxxType(t.of)}>`;
    case "optional":
      return `std::optional<${formatCxxType(t.of)}>`;
    case "enum":
      return t.name;
    case "class":
      return {
        value: t.name,
        ref: `${t.name} &`,
        constRef: `const ${t.name} &`,
        pointer: `${t.name} *`,
        constPointer: `const ${t.name} *`,
      }[t.by];
    case "function":
      return `std::function<${formatCxxType(t.result)} (${t.params.map(formatCxxType).join(", ")})>`;
    case "unknown":
      return t.spelling;
  }
}
