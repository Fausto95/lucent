import type { Decl, Doc, Expr, Member, Param, Stmt, Type, TypeParam, Unit } from "./ast.ts";

const INDENT = "  ";

// --- types -----------------------------------------------------------------------------

/**
 * Where a type goes: an array element (or an optional tuple element) binds
 * tighter than an intersection member, which binds tighter than a union
 * member, which binds tighter than anything else.
 */
const At = { top: 0, unionMember: 1, intersectionMember: 2, arrayElement: 3 } as const;
type At = (typeof At)[keyof typeof At];

function type(t: Type, at: At): string {
  const text = bareType(t);
  const loose =
    t.k === "fn"
      ? At.top
      : t.k === "union"
        ? At.unionMember
        : t.k === "intersection"
          ? At.intersectionMember
          : At.arrayElement;
  return loose < at ? `(${text})` : text;
}

function bareType(t: Type): string {
  switch (t.k) {
    case "keyword":
      return t.name;
    case "ref":
      return t.args?.length ? `${t.name}<${t.args.map(printType).join(", ")}>` : t.name;
    case "array":
      return `${t.readonly ? "readonly " : ""}${type(t.of, At.arrayElement)}[]`;
    case "union":
      return t.members.map((m) => type(m, At.unionMember)).join(" | ");
    case "intersection":
      return t.members.map((m) => type(m, At.intersectionMember)).join(" & ");
    case "tuple":
      return `[${t.elements
        .map((e) =>
          e.name
            ? `${e.name}${e.optional ? "?" : ""}: ${printType(e.type)}`
            : e.optional
              ? `${type(e.type, At.arrayElement)}?`
              : printType(e.type),
        )
        .join(", ")}]`;
    case "fn":
      return `(${params(t.params)}) => ${printType(t.ret)}`;
    case "object":
      return t.members.length
        ? `{ ${t.members.map((m) => `${m.readonly ? "readonly " : ""}${propertyName(m.name)}${m.optional ? "?" : ""}: ${printType(m.type)}`).join("; ")} }`
        : "{}";
    case "literal":
      return typeof t.value === "bigint" ? `${t.value}n` : JSON.stringify(t.value);
    case "typeof":
      return `typeof ${t.name}`;
  }
}

export function printType(t: Type): string {
  return type(t, At.top);
}

/** A property's name as a type member declares it: quoted unless it is an identifier. */
const propertyName = (name: string) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

const params = (ps: Param[]) =>
  ps.map((p) => `${p.name}${p.optional ? "?" : ""}: ${printType(p.type)}`).join(", ");
const typeParams = (ps: TypeParam[] | undefined) =>
  ps?.length
    ? `<${ps
        .map(
          (p) =>
            `${p.name}${p.extends ? ` extends ${printType(p.extends)}` : ""}${p.default ? ` = ${printType(p.default)}` : ""}`,
        )
        .join(", ")}>`
    : "";

// --- expressions and statements --------------------------------------------------------

export function printExpr(e: Expr): string {
  return expr(e, "");
}

/** Items between brackets: on one line, or one per line indented past `indent`. */
function list(open: string, close: string, items: string[], multiline: boolean, indent: string) {
  if (!items.length) return `${open}${close}`;
  if (!multiline) return open === "{" ? `{ ${items.join(", ")} }` : `[${items.join(", ")}]`;

  return `${open}\n${items.map((i) => `${indent}${INDENT}${i},`).join("\n")}\n${indent}${close}`;
}

function expr(e: Expr, indent: string): string {
  const inner = (x: Expr) => expr(x, indent);
  const nested = (x: Expr) => expr(x, indent + INDENT);

  switch (e.k) {
    case "name":
      return e.name;
    case "string":
      return JSON.stringify(e.value);
    case "number":
      return String(e.value);
    case "bool":
      return String(e.value);
    case "null":
      return "null";
    case "member":
      return `${inner(e.object)}.${e.name}`;
    case "call":
      return `${inner(e.callee)}(${e.args.map(inner).join(", ")})`;
    case "arrow": {
      const body = inner(e.body);
      return `(${e.params.join(", ")}) => ${e.body.k === "object" ? `(${body})` : body}`;
    }
    case "array": {
      const item = e.multiline ? nested : inner;
      return list("[", "]", e.items.map(item), !!e.multiline, indent);
    }
    case "object": {
      const value = e.multiline ? nested : inner;
      const props = e.props.map(
        (p) => `${p.quoted ? JSON.stringify(p.key) : p.key}: ${value(p.value)}`,
      );
      return list("{", "}", props, !!e.multiline, indent);
    }
    case "assign":
      return `${inner(e.target)} = ${inner(e.value)}`;
  }
}

function stmt(s: Stmt): string {
  switch (s.k) {
    case "expr":
      return `${printExpr(s.expr)};`;
    case "const": {
      const name = typeof s.name === "string" ? s.name : `{ ${s.name.join(", ")} }`;
      return `const ${name} = ${printExpr(s.init)};`;
    }
  }
}

// --- declarations ----------------------------------------------------------------------

/** A documentation comment, indented by `indent`: one line, or one per entry. */
function docLines(d: Doc | undefined, indent = ""): string[] {
  if (d === undefined || (Array.isArray(d) && !d.length)) return [];
  if (typeof d === "string") return [`${indent}/** ${d} */`];

  return [`${indent}/**`, ...d.map((l) => `${indent} * ${l}`), `${indent} */`];
}

function member(m: Member): string[] {
  const doc = docLines(m.doc, INDENT);
  switch (m.k) {
    case "property": {
      const mods = `${m.private ? "private " : ""}${m.static ? "static " : ""}${m.readonly ? "readonly " : ""}`;
      const name = m.computed ? `[${m.name}]` : propertyName(m.name);
      if (m.set) {
        const at = `${INDENT}${m.private ? "private " : ""}${m.static ? "static " : ""}`;
        return [
          ...doc,
          `${at}get ${name}(): ${printType(m.type)};`,
          `${at}set ${name}(value: ${printType(m.set)});`,
        ];
      }

      return [...doc, `${INDENT}${mods}${name}${m.optional ? "?" : ""}: ${printType(m.type)};`];
    }
    case "call":
      return [
        ...doc,
        `${INDENT}${typeParams(m.typeParams)}(${params(m.params)}): ${printType(m.ret)};`,
      ];
    case "constructor":
      return [
        ...doc,
        `${INDENT}${m.protected ? "protected " : m.private ? "private " : ""}constructor(${params(m.params)});`,
      ];
    case "method":
      return [
        ...doc,
        `${INDENT}${m.static ? "static " : ""}${m.name}${m.optional ? "?" : ""}${typeParams(m.typeParams)}(${params(m.params)}): ${printType(m.ret)};`,
      ];
  }
}

/** `head {…}`: members one per line, or `{}` for none. */
function body(head: string, lines: string[]): string[] {
  return lines.length ? [`${head} {`, ...lines, "}"] : [`${head} {}`];
}

function decl(d: Decl): string[] {
  switch (d.k) {
    case "importType":
      return [`import type { ${d.names.join(", ")} } from ${JSON.stringify(d.from)};`];
    case "exportFrom":
      return [`export * from ${JSON.stringify(d.from)};`];
    case "enum":
      return body(
        `export declare enum ${d.name}`,
        d.members.map((m) => `${INDENT}${m.name} = ${JSON.stringify(m.value)},`),
      );
    case "typeAlias":
      return [`export declare type ${d.name}${typeParams(d.typeParams)} = ${printType(d.type)};`];
    case "class": {
      const doc = d.doc?.length ? ["/**", ...d.doc.map((l) => ` * ${l}`), " */"] : [];
      const ext = d.extends ? ` extends ${printType(d.extends)}` : "";
      return [
        ...doc,
        ...body(
          `export declare ${d.abstract ? "abstract " : ""}class ${d.name}${typeParams(d.typeParams)}${ext}`,
          d.members.flatMap(member),
        ),
      ];
    }
    case "interface": {
      const ext = d.extends?.length ? ` extends ${d.extends.map(printType).join(", ")}` : "";
      return [
        ...docLines(d.doc),
        ...body(
          `${d.local ? "" : "export "}declare interface ${d.name}${typeParams(d.typeParams)}${ext}`,
          d.members.flatMap(member),
        ),
      ];
    }
    case "function":
      return [
        ...docLines(d.doc),
        `export declare function ${d.name}${typeParams(d.typeParams)}(${params(d.params)}): ${printType(d.ret)};`,
      ];
    case "const":
      return [
        ...docLines(d.doc),
        `${d.local ? "" : "export "}declare const ${d.name}: ${printType(d.type)};`,
      ];
    case "namespace":
      return body(`export declare namespace ${d.name}`, d.decls.flatMap(inNamespace));
    case "exportNothing":
      return ["export {};"];
    case "moduleWildcard":
      return [`declare module ${JSON.stringify(d.name)};`];
    case "stmt":
      return [stmt(d.stmt)];
    case "blank":
      return [""];
  }
}

/**
 * A declaration in a namespace, which is ambient already (its declarations
 * are exported without saying so): type aliases, namespaces, constants,
 * functions and interfaces, which merge with the namespace's own name's.
 */
function inNamespace(d: Decl): string[] {
  const at = (lines: string[]) => lines.map((l) => (l ? `${INDENT}${l}` : l));

  switch (d.k) {
    case "typeAlias":
      return [`${INDENT}type ${d.name}${typeParams(d.typeParams)} = ${printType(d.type)};`];
    case "namespace":
      return at(body(`namespace ${d.name}`, d.decls.flatMap(inNamespace)));
    case "const":
      return at([...docLines(d.doc), `const ${d.name}: ${printType(d.type)};`]);
    case "function":
      return at([
        ...docLines(d.doc),
        `function ${d.name}${typeParams(d.typeParams)}(${params(d.params)}): ${printType(d.ret)};`,
      ]);
    case "interface": {
      const ext = d.extends?.length ? ` extends ${d.extends.map(printType).join(", ")}` : "";
      return at([
        ...docLines(d.doc),
        ...body(`interface ${d.name}${typeParams(d.typeParams)}${ext}`, d.members.flatMap(member)),
      ]);
    }
    default:
      throw new Error(`a namespace cannot declare a ${d.k}`);
  }
}

export function printUnit(u: Unit): string {
  return `${[...(u.banner ? [`// ${u.banner}`] : []), ...u.decls.flatMap(decl)].join("\n")}\n`;
}
