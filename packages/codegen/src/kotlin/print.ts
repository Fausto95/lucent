import type {
  Arg,
  Decl,
  Expr,
  Fun,
  Member,
  Modifier,
  Param,
  Property,
  Stmt,
  Type,
  Unit,
} from "./ast.ts";

const INDENT = "  ";

// --- identifiers and literals ----------------------------------------------------------

/** Kotlin's hard keywords: as identifiers they need backticks. */
const KEYWORDS = new Set([
  "as",
  "break",
  "class",
  "continue",
  "do",
  "else",
  "false",
  "for",
  "fun",
  "if",
  "in",
  "interface",
  "is",
  "null",
  "object",
  "package",
  "return",
  "super",
  "this",
  "throw",
  "true",
  "try",
  "typealias",
  "typeof",
  "val",
  "var",
  "when",
  "while",
]);

function ident(n: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
    throw new Error(`${JSON.stringify(n)} is not a Kotlin identifier`);

  return KEYWORDS.has(n) ? `\`${n}\`` : n;
}

/** A qualified name (`kotlin.coroutines.Continuation`), each part escaped. */
function qualified(n: string): string {
  return n.split(".").map(ident).join(".");
}

function stringLiteral(value: string): string {
  let out = '"';

  for (const ch of value) {
    const code = ch.codePointAt(0)!;

    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "$") out += "\\$";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }

  return `${out}"`;
}

function numberLiteral(text: string): string {
  if (!/^-?(0[xXbB][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)[LuUfF]*$/.test(text))
    throw new Error(`${JSON.stringify(text)} is not a Kotlin number literal`);

  return text;
}

// --- types -----------------------------------------------------------------------------

export function printType(t: Type): string {
  switch (t.k) {
    case "named":
      return t.args?.length
        ? `${qualified(t.name)}<${t.args.map(printType).join(", ")}>`
        : qualified(t.name);
    case "nullable":
      return t.of.k === "function" ? `(${printType(t.of)})?` : `${printType(t.of)}?`;
    case "function": {
      const fnType = `(${t.params.map(printType).join(", ")}) -> ${printType(t.ret)}`;
      return t.suspend ? `suspend ${fnType}` : fnType;
    }
    case "star":
      return "*";
    default:
      throw new Error(`unsupported Kotlin type ${JSON.stringify(t)}`);
  }
}

// --- expressions -----------------------------------------------------------------------

/** Kotlin's precedence, higher binding tighter. */
const PREC = {
  lowest: 1,
  disjunction: 2,
  conjunction: 3,
  equality: 4,
  comparison: 5,
  namedCheck: 6,
  elvis: 7,
  additive: 9,
  multiplicative: 10,
  typeCast: 11,
  prefix: 12,
  postfix: 13,
};

const BINARY: Record<string, number> = {
  "||": PREC.disjunction,
  "&&": PREC.conjunction,
  "==": PREC.equality,
  "!=": PREC.equality,
  "===": PREC.equality,
  "!==": PREC.equality,
  "<": PREC.comparison,
  ">": PREC.comparison,
  "<=": PREC.comparison,
  ">=": PREC.comparison,
  "+": PREC.additive,
  "-": PREC.additive,
  "*": PREC.multiplicative,
  "/": PREC.multiplicative,
  "%": PREC.multiplicative,
};

function precedence(e: Expr): number {
  switch (e.k) {
    case "binary":
      return BINARY[e.op]!;
    case "elvis":
      return PREC.elvis;
    case "is":
      return PREC.namedCheck;
    case "cast":
      return PREC.typeCast;
    case "not":
      return PREC.prefix;
    case "ifExpr":
    case "object":
      return PREC.lowest;
    default:
      return PREC.postfix;
  }
}

function expr(e: Expr, min: number, indent: string): string {
  const text = bare(e, indent);
  return precedence(e) < min ? `(${text})` : text;
}

const args = (as: Arg[], indent: string) =>
  as
    .map((a) => `${a.name ? `${ident(a.name)} = ` : ""}${expr(a.value, PREC.lowest, indent)}`)
    .join(", ");

function bare(e: Expr, indent: string): string {
  switch (e.k) {
    case "name":
      return ident(e.name);
    case "number":
      return numberLiteral(e.text);
    case "string":
      return stringLiteral(e.value);
    case "bool":
      return String(e.value);
    case "null":
      return "null";
    case "this":
      return "this";
    case "member":
      return `${expr(e.object, PREC.postfix, indent)}${e.safe ? "?." : "."}${ident(e.name)}`;
    case "index":
      return `${expr(e.object, PREC.postfix, indent)}[${expr(e.index, PREC.lowest, indent)}]`;
    case "call": {
      const callee = expr(e.callee, PREC.postfix, indent);
      const typeArgs = e.typeArgs?.length ? `<${e.typeArgs.map(printType).join(", ")}>` : "";
      const trailing = e.trailing ? ` ${lambda(e.trailing, indent)}` : "";

      if (e.trailing && !e.args.length) return `${callee}${typeArgs}${trailing}`;
      return `${callee}${typeArgs}(${args(e.args, indent)})${trailing}`;
    }
    case "lambda":
      return lambda(e, indent);
    case "object": {
      const sup = e.supertypes.length ? ` : ${e.supertypes.map(printType).join(", ")}` : "";
      return [`object${sup} {`, ...members(e.members, indent + INDENT), `${indent}}`].join("\n");
    }
    case "cast":
      return `${expr(e.value, PREC.typeCast, indent)} ${e.safe ? "as?" : "as"} ${printType(e.type)}`;
    case "is":
      return `${expr(e.value, PREC.namedCheck + 1, indent)} ${e.negated ? "!is" : "is"} ${printType(e.type)}`;
    case "notNull":
      return `${expr(e.value, PREC.postfix, indent)}!!`;
    case "not":
      return `!${expr(e.value, PREC.prefix, indent)}`;
    case "elvis":
      // Right-associative: `a ?: b ?: c` is `a ?: (b ?: c)`.
      return `${expr(e.left, PREC.elvis + 1, indent)} ?: ${expr(e.right, PREC.elvis, indent)}`;
    case "binary": {
      const p = BINARY[e.op]!;
      return `${expr(e.left, p, indent)} ${e.op} ${expr(e.right, p + 1, indent)}`;
    }
    case "ifExpr":
      return `if (${expr(e.test, PREC.lowest, indent)}) ${expr(e.whenTrue, PREC.lowest, indent)} else ${expr(e.whenFalse, PREC.lowest, indent)}`;
    default:
      throw new Error(`unsupported Kotlin expression ${JSON.stringify(e)}`);
  }
}

/** A lambda: on one line when it is one expression statement. */
function lambda(l: Expr & { k: "lambda" }, indent: string): string {
  const head = l.params.length ? ` ${l.params.map(ident).join(", ")} ->` : "";
  const [only] = l.body;

  if (l.body.length === 1 && only?.k === "expr")
    return `{${head} ${expr(only.expr, PREC.lowest, indent)} }`;

  return `{${head}\n${block(l.body, indent + INDENT).join("\n")}\n${indent}}`;
}

export function printExpr(e: Expr): string {
  return expr(e, PREC.lowest, "");
}

// --- statements ------------------------------------------------------------------------

function block(stmts: Stmt[], indent: string): string[] {
  return stmts.flatMap((s) => stmt(s, indent));
}

function stmt(s: Stmt, indent: string): string[] {
  const inner = (b: Stmt[]) => block(b, indent + INDENT);
  const e = (x: Expr) => expr(x, PREC.lowest, indent);

  switch (s.k) {
    case "expr":
      return [`${indent}${e(s.expr)}`];
    case "val":
    case "var": {
      const type = s.type ? `: ${printType(s.type)}` : "";
      return [`${indent}${s.k} ${ident(s.name)}${type}${s.init ? ` = ${e(s.init)}` : ""}`];
    }
    case "assign":
      return [`${indent}${expr(s.target, PREC.postfix, indent)} = ${e(s.value)}`];
    case "return": {
      const label = s.label ? `@${ident(s.label)}` : "";
      return [`${indent}return${label}${s.value ? ` ${e(s.value)}` : ""}`];
    }
    case "throw":
      return [`${indent}throw ${e(s.value)}`];
    case "if": {
      const out = [`${indent}if (${e(s.test)}) {`, ...inner(s.body)];
      if (s.orElse) out.push(`${indent}} else {`, ...inner(s.orElse));
      return [...out, `${indent}}`];
    }
    case "when": {
      const subject = s.subject ? ` (${e(s.subject)})` : "";
      const branches = s.branches.flatMap((b) => [
        `${indent}${INDENT}${b.conditions.length ? b.conditions.map((c) => expr(c, PREC.lowest, indent)).join(", ") : "else"} -> {`,
        ...block(b.body, indent + INDENT + INDENT),
        `${indent}${INDENT}}`,
      ]);
      return [`${indent}when${subject} {`, ...branches, `${indent}}`];
    }
    case "try": {
      const out = [`${indent}try {`, ...inner(s.body)];
      for (const c of s.catches)
        out.push(`${indent}} catch (${ident(c.name)}: ${printType(c.type)}) {`, ...inner(c.body));
      if (s.finally) out.push(`${indent}} finally {`, ...inner(s.finally));
      return [...out, `${indent}}`];
    }
    default:
      throw new Error(`unsupported Kotlin statement ${JSON.stringify(s)}`);
  }
}

// --- declarations ----------------------------------------------------------------------

/** Kotlin's conventional modifier order. */
const MODIFIER_ORDER: Modifier[] = [
  "public",
  "protected",
  "internal",
  "private",
  "final",
  "open",
  "abstract",
  "const",
  "external",
  "override",
  "lateinit",
  "suspend",
  "inline",
  "operator",
];

const mods = (ms: Modifier[] | undefined) =>
  [...(ms ?? [])]
    .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
    .map((m) => `${m} `)
    .join("");

const annotations = (as: string[] | undefined, indent: string) =>
  (as ?? []).map((a) => `${indent}@${a}`);

const params = (ps: Param[], indent: string) =>
  ps
    .map(
      (p) =>
        `${ident(p.name)}: ${printType(p.type)}${p.default ? ` = ${expr(p.default, PREC.lowest, indent)}` : ""}`,
    )
    .join(", ");

function fun(f: Fun, indent: string): string[] {
  const bounds = (n: string) => f.bounds?.[n] ?? [];
  const typeParam = (n: string) => {
    const [only, ...more] = bounds(n);
    return only && !more.length ? `${ident(n)} : ${printType(only)}` : ident(n);
  };
  const where = (f.typeParams ?? [])
    .filter((n) => bounds(n).length > 1)
    .flatMap((n) => bounds(n).map((b) => `${ident(n)} : ${printType(b)}`));

  const tps = f.typeParams?.length ? `<${f.typeParams.map(typeParam).join(", ")}> ` : "";
  const receiver = f.receiver ? `${printType(f.receiver)}.` : "";
  const ret = f.ret ? `: ${printType(f.ret)}` : "";
  const clause = where.length ? ` where ${where.join(", ")}` : "";
  const head = `${indent}${mods(f.modifiers)}fun ${tps}${receiver}${ident(f.name)}(${params(f.params, indent)})${ret}${clause}`;

  return [
    ...annotations(f.annotations, indent),
    ...(f.body ? [`${head} {`, ...block(f.body, indent + INDENT), `${indent}}`] : [head]),
  ];
}

function property(p: Property, indent: string): string[] {
  const type = p.type ? `: ${printType(p.type)}` : "";
  const init = p.init ? ` = ${expr(p.init, PREC.lowest, indent)}` : "";

  return [
    ...annotations(p.annotations, indent),
    `${indent}${mods(p.modifiers)}${p.k} ${ident(p.name)}${type}${init}`,
  ];
}

/** Members: properties together, a blank line before each function. */
function members(ms: Member[], indent: string): string[] {
  return ms.flatMap((m, i) => [
    ...(i && m.k === "fun" ? [""] : []),
    ...(m.k === "fun" ? fun(m, indent) : property(m, indent)),
  ]);
}

function decl(d: Decl): string[] {
  switch (d.k) {
    case "fun":
      return fun(d, "");
    case "val":
    case "var":
      return property(d, "");
    case "comment":
      return d.text.split("\n").map((l) => `// ${l}`.trimEnd());
    case "object": {
      const sup = d.supertypes?.length ? ` : ${d.supertypes.map(printType).join(", ")}` : "";
      return [
        `${mods(d.modifiers)}object ${ident(d.name)}${sup} {`,
        ...members(d.members, INDENT),
        "}",
      ];
    }
    case "class": {
      const tps = d.typeParams?.length ? `<${d.typeParams.map(ident).join(", ")}>` : "";
      const ctor = d.params
        ? `(${d.params.map((p) => `${p.property ? `${p.property} ` : ""}${params([p], "")}`).join(", ")})`
        : "";
      const sup = d.supertypes?.length
        ? ` : ${d.supertypes.map((s) => `${printType(s.type)}${s.args ? `(${args(s.args, "")})` : ""}`).join(", ")}`
        : "";
      const body = d.members.length ? [" {", ...members(d.members, INDENT), "}"] : [""];
      const [open, ...rest] = body;
      return [`${mods(d.modifiers)}class ${ident(d.name)}${tps}${ctor}${sup}${open}`, ...rest];
    }
    default:
      throw new Error(`unsupported Kotlin declaration ${JSON.stringify(d)}`);
  }
}

export function printUnit(u: Unit): string {
  const lines: string[] = u.banner ? [`// ${u.banner}`] : [];

  for (const a of u.fileAnnotations ?? []) lines.push(`@file:${a}`);
  if (lines.length) lines.push("");

  lines.push(`package ${qualified(u.packageName)}`);

  if (u.imports?.length) lines.push("", ...u.imports.map((i) => `import ${qualified(i)}`));

  for (const d of u.decls) lines.push("", ...decl(d));

  return `${lines.join("\n")}\n`;
}
