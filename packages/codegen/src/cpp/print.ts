import type {
  Decl,
  Expr,
  Member,
  ObjcMethod,
  Param,
  Stmt,
  TemplateArg,
  Type,
  Unit,
} from "./ast.ts";

const INDENT = "  ";

// --- literals --------------------------------------------------------------------------

/** A C++ string literal holding the UTF-8 bytes of `s`: printable ASCII as is, the rest octal-escaped (and `?`, against trigraphs). */
export function quoted(s: string): string {
  let out = '"';
  for (const b of Buffer.from(s, "utf8")) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += "\\\\";
    else if (b >= 0x20 && b < 0x7f && b !== 0x3f) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `${out}"`;
}

/**
 * A `u"…"` literal of UTF-16 code units, each hex-escaped: a universal
 * character name may not name a surrogate, a hex escape may.
 */
function quoted16(s: string): string {
  let out = 'u"';
  for (let i = 0; i < s.length; i++) out += `\\x${s.charCodeAt(i).toString(16)}`;
  return `${out}"`;
}

// --- types -----------------------------------------------------------------------------

export function printType(t: Type): string {
  switch (t.k) {
    case "named":
      return t.args ? `${t.name}<${t.args.map(printTemplateArg).join(", ")}>` : t.name;
    case "pointer":
      return `${printType(t.to)}*${t.ownership ? ` ${t.ownership}` : ""}`;
    case "reference":
      return `${printType(t.to)}${t.rvalue ? "&&" : "&"}`;
    case "const":
      return `const ${printType(t.of)}`;
    case "auto":
      return "auto";
    case "decltype":
      return `decltype(${expr(t.of, 0, "")})`;
    case "function":
      return `${printType(t.ret)}(${t.params.map(printType).join(", ")})`;
    case "block":
      return `${printType(t.ret)} (^)(${t.params.map(printType).join(", ")})`;
    case "protocol":
      return `id<${t.name}>`;
    case "nested":
      return `typename ${printType(t.of)}::${t.name}`;
  }
}

const TYPE_KINDS = new Set([
  "named",
  "pointer",
  "reference",
  "const",
  "auto",
  "decltype",
  "function",
  "block",
  "protocol",
  "nested",
]);

/** A template argument; an expression cannot hold an unparenthesized `>`, which would end the list. */
function printTemplateArg(a: TemplateArg): string {
  return isType(a) ? printType(a) : expr(a, PREC.shift + 1, "");
}

function isType(a: TemplateArg): a is Type {
  return TYPE_KINDS.has(a.k);
}

// --- expressions -----------------------------------------------------------------------

/** Precedence, higher binding tighter (C++'s table). */
const PREC = {
  comma: 1,
  assign: 2,
  conditional: 2,
  or: 3,
  and: 4,
  bitor: 5,
  bitxor: 6,
  bitand: 7,
  equality: 8,
  relational: 9,
  shift: 10,
  additive: 11,
  multiplicative: 12,
  unary: 13,
  postfix: 14,
  primary: 15,
} as const;

const BINARY: Record<string, number> = {
  "*": PREC.multiplicative,
  "/": PREC.multiplicative,
  "%": PREC.multiplicative,
  "+": PREC.additive,
  "-": PREC.additive,
  "<<": PREC.shift,
  ">>": PREC.shift,
  "<": PREC.relational,
  "<=": PREC.relational,
  ">": PREC.relational,
  ">=": PREC.relational,
  "==": PREC.equality,
  "!=": PREC.equality,
  "&": PREC.bitand,
  "^": PREC.bitxor,
  "|": PREC.bitor,
  "&&": PREC.and,
  "||": PREC.or,
};

function precedence(e: Expr): number {
  switch (e.k) {
    case "number":
      return e.text.startsWith("-") ? PREC.unary : PREC.primary;
    case "call":
    case "member":
    case "index":
    case "postfix":
    case "construct":
      return PREC.postfix;
    case "cast":
      return e.kind === "c" || e.kind.startsWith("bridge") ? PREC.unary : PREC.postfix;
    case "unary":
    case "new":
    case "coAwait":
    case "sizeof":
      return PREC.unary;
    case "binary":
      return BINARY[e.op]!;
    case "assign":
      return PREC.assign;
    case "conditional":
      return PREC.conditional;
    case "comma":
      return PREC.comma;
    default:
      return PREC.primary;
  }
}

/**
 * Operators clang wants parenthesized when mixed with another operator
 * (-Wparentheses, -Wbitwise-op-parentheses, -Wshift-op-parentheses,
 * -Wlogical-op-parentheses): the generated code builds with -Werror.
 */
const MIXED = new Set(["&", "|", "^", "<<", ">>", "&&", "||"]);

/** Tests of `?:` clang wants parenthesized: arithmetic, shifts and bitwise operators. */
const ARITHMETIC_TEST = new Set(["*", "/", "%", "+", "-", "<<", ">>", "&", "^", "|"]);

/**
 * An expression, parenthesized when it binds looser than `min`; `indent` is
 * the indentation of the line it starts on, for bodies that span lines.
 */
function expr(e: Expr, min: number, indent: string): string {
  const s = bare(e, indent);
  return precedence(e) < min ? `(${s})` : s;
}

/** Arguments, list items and initializers: anything but a comma expression. */
const item = (e: Expr, indent: string) => expr(e, PREC.assign, indent);

function bare(e: Expr, indent: string): string {
  switch (e.k) {
    case "id":
      return e.args ? `${e.name}<${e.args.map(printTemplateArg).join(", ")}>` : e.name;
    case "scope":
      return `${printType(e.type)}::${e.name}`;
    case "number":
      return e.text;
    case "string":
      return e.prefix === "u" ? quoted16(e.value) : quoted(e.value);
    case "bool":
      return String(e.value);
    case "nullptr":
      return "nullptr";
    case "this":
      return "this";
    case "call": {
      const targs = e.templateArgs ? `<${e.templateArgs.map(printTemplateArg).join(", ")}>` : "";
      return `${expr(e.callee, PREC.postfix, indent)}${targs}(${e.args.map((a) => item(a, indent)).join(", ")})`;
    }
    case "member":
      return `${expr(e.object, PREC.postfix, indent)}${e.arrow ? "->" : "."}${e.template ? "template " : ""}${e.base ? `${printType(e.base)}::` : ""}${e.name}`;
    case "index":
      return `${expr(e.object, PREC.postfix, indent)}[${expr(e.index, 0, indent)}]`;
    case "unary": {
      const operand = expr(e.operand, PREC.unary, indent);
      // `- -x` and `& &x` must not merge into `--x` and `&&x`.
      const glue = /^[-+&]/.test(operand) && operand[0] === e.op[e.op.length - 1] ? " " : "";
      return `${e.op}${glue}${operand}`;
    }
    case "postfix":
      return `${expr(e.operand, PREC.postfix, indent)}${e.op}`;
    case "binary": {
      const p = BINARY[e.op]!;
      const side = (x: Expr, min: number) =>
        x.k === "binary" && x.op !== e.op && (MIXED.has(e.op) || MIXED.has(x.op))
          ? `(${bare(x, indent)})`
          : expr(x, min, indent);
      return `${side(e.left, p)} ${e.op} ${side(e.right, p + 1)}`;
    }
    case "assign":
      return `${expr(e.target, PREC.unary, indent)} ${e.op} ${expr(e.value, PREC.assign, indent)}`;
    case "conditional":
      // Clang wants an arithmetic or bitwise test parenthesized (-Wparentheses).
      return `${e.test.k === "binary" && ARITHMETIC_TEST.has(e.test.op) ? `(${bare(e.test, indent)})` : expr(e.test, PREC.or, indent)} ? ${expr(e.whenTrue, PREC.comma, indent)} : ${expr(e.whenFalse, PREC.assign, indent)}`;
    case "comma":
      return e.items.map((x) => expr(x, PREC.assign, indent)).join(", ");
    case "cast":
      switch (e.kind) {
        case "c":
          return `(${printType(e.type)})${expr(e.operand, PREC.unary, indent)}`;
        case "bridge":
        case "bridge_transfer":
        case "bridge_retained":
          return `(__${e.kind} ${printType(e.type)})${expr(e.operand, PREC.unary, indent)}`;
        default:
          return `${e.kind}_cast<${printType(e.type)}>(${expr(e.operand, 0, indent)})`;
      }
    case "construct": {
      const args = e.args.map((a) => item(a, indent)).join(", ");
      return e.braces ? `${printType(e.type)}{${args}}` : `${printType(e.type)}(${args})`;
    }
    case "initList":
      return `{${e.items.map((a) => item(a, indent)).join(", ")}}`;
    case "new":
      return `new ${printType(e.type)}(${e.args.map((a) => item(a, indent)).join(", ")})`;
    case "coAwait":
      return `co_await ${expr(e.operand, PREC.unary, indent)}`;
    case "sizeof":
      return isType(e.of as TemplateArg)
        ? `sizeof(${printType(e.of as Type)})`
        : `sizeof(${expr(e.of as Expr, 0, indent)})`;
    case "lambda": {
      const captures = e.captures.map((c) =>
        typeof c === "string" ? c : `${c.name} = ${expr(c.init, PREC.assign, indent)}`,
      );
      const head = `[${captures.join(", ")}](${params(e.params)})${e.mutable ? " mutable" : ""}${e.ret ? ` -> ${printType(e.ret)}` : ""}`;
      return `${head} ${body(e.body, indent, true)}`;
    }
    case "statementExpr": {
      const inner = [...e.body, { k: "expr", expr: e.value } as Stmt];
      return `(${body(inner, indent)})`;
    }
    case "send": {
      const receiver = expr(e.receiver, PREC.postfix, indent);
      if (!e.selector.includes(":")) return `[${receiver} ${e.selector}]`;
      const parts = e.selector.split(":").slice(0, -1);
      return `[${receiver} ${parts.map((p, i) => `${p}:${item(e.args[i]!, indent)}`).join(" ")}]`;
    }
    case "blockLiteral":
      return `^${e.ret ? `${printType(e.ret)} ` : ""}(${params(e.params)}) ${body(e.body, indent)}`;
    case "box":
      return `@(${expr(e.operand, 0, indent)})`;
    case "selector":
      return `@selector(${e.name})`;
  }
}

function printParam(p: Param): string {
  return p.name ? declarator(p.type, p.name) : printType(p.type);
}

/** `T name`; a block's name goes inside its type, as C declarators have it: `void (^done)(BOOL)`. */
function declarator(t: Type, name: string): string {
  if (t.k === "block")
    return `${printType(t.ret)} (^${name})(${t.params.map(printType).join(", ")})`;
  return `${printType(t)} ${name}`;
}

function params(ps: Param[]): string {
  return ps.map(printParam).join(", ");
}

/**
 * A braced body inside an expression: on one line when it is simple
 * statements (unless `multiline`, as for lambdas), else one statement per line,
 * indented from `indent`.
 */
function body(stmts: Stmt[], indent: string, multiline = false): string {
  if (stmts.length === 0) return "{}";
  if (multiline)
    return `{\n${stmts.flatMap((s) => stmt(s, indent + INDENT)).join("\n")}\n${indent}}`;
  const simple = stmts.every(
    (s) => s.k === "expr" || s.k === "var" || s.k === "return" || s.k === "break",
  );
  const lines = stmts.flatMap((s) => stmt(s, simple ? "" : indent + INDENT));
  if (simple && lines.every((l) => !l.includes("\n")) && !lines.some((l) => l.startsWith("#")))
    return `{ ${lines.join(" ")} }`;
  const inner = simple ? stmts.flatMap((s) => stmt(s, indent + INDENT)) : lines;
  return `{\n${inner.join("\n")}\n${indent}}`;
}

// --- statements ------------------------------------------------------------------------

/** A statement's lines, each already indented by `indent`. */
export function stmt(s: Stmt, indent: string): string[] {
  const one = (text: string) => [`${indent}${text}`];
  const block = (stmts: Stmt[]) => stmts.flatMap((x) => stmt(x, indent + INDENT));
  switch (s.k) {
    case "expr":
      return one(`${expr(s.expr, 0, indent)};`);
    case "var": {
      const head = `${s.static ? "static " : ""}${s.constexpr ? "constexpr " : ""}${declarator(s.type, s.name)}${s.array ? "[]" : ""}`;
      if (!s.init) return one(s.style === "brace" ? `${head}{};` : `${head};`);
      switch (s.style) {
        case "construct":
          return one(`${head}(${expr(s.init, 0, indent)});`);
        case "brace":
          return one(`${head}{${expr(s.init, 0, indent)}};`);
        default:
          return one(`${head} = ${expr(s.init, PREC.assign, indent)};`);
      }
    }
    case "return": {
      const kw = s.co ? "co_return" : "return";
      return one(s.value ? `${kw} ${expr(s.value, 0, indent)};` : `${kw};`);
    }
    case "coYield":
      return one(`co_yield ${expr(s.value, PREC.assign, indent)};`);
    case "if": {
      const condition = (x: Stmt & { k: "if" }) =>
        x.bind
          ? `${printType(x.bind.type)} ${x.bind.name} = ${expr(x.test, PREC.assign, indent)}`
          : expr(x.test, 0, indent);
      const out = [`${indent}if (${condition(s)}) {`, ...block(s.body)];
      let rest = s.orElse;
      while (rest) {
        const only = rest.length === 1 ? rest[0] : undefined;
        if (only?.k === "if") {
          out.push(`${indent}} else if (${condition(only)}) {`, ...block(only.body));
          rest = only.orElse;
        } else {
          out.push(`${indent}} else {`, ...block(rest));
          rest = undefined;
        }
      }
      out.push(`${indent}}`);
      return out;
    }
    case "while":
      return [`${indent}while (${expr(s.test, 0, indent)}) {`, ...block(s.body), `${indent}}`];
    case "doWhile":
      return [`${indent}do {`, ...block(s.body), `${indent}} while (${expr(s.test, 0, indent)});`];
    case "for": {
      const init = s.init ? stmt(s.init, "")[0]!.replace(/;$/, "") : "";
      const test = s.test ? ` ${expr(s.test, 0, indent)}` : "";
      const update = s.update ? ` ${expr(s.update, 0, indent)}` : "";
      return [`${indent}for (${init};${test};${update}) {`, ...block(s.body), `${indent}}`];
    }
    case "forRange":
      return [
        `${indent}for (${printType(s.type)} ${s.name} : ${expr(s.range, 0, indent)}) {`,
        ...block(s.body),
        `${indent}}`,
      ];
    case "switch":
      return [
        `${indent}switch (${expr(s.on, 0, indent)}) {`,
        ...s.cases.flatMap((c) => [
          ...c.values.map((v) => `${indent}${INDENT}case ${expr(v, 0, indent)}:`),
          ...(c.isDefault ? [`${indent}${INDENT}default:`] : []),
          ...c.body.flatMap((x) => stmt(x, indent + INDENT + INDENT)),
        ]),
        `${indent}}`,
      ];
    case "block":
      return [`${indent}{`, ...block(s.body), `${indent}}`];
    case "break":
      return one("break;");
    case "continue":
      return one("continue;");
    case "goto":
      return one(`goto ${s.label};`);
    case "label":
      return one(`${s.name}:;`);
    case "throw":
      return one(s.value ? `throw ${expr(s.value, PREC.assign, indent)};` : "throw;");
    case "try":
      return [
        `${indent}try {`,
        ...block(s.body),
        ...s.catches.flatMap((c) => [
          `${indent}} catch (${c.param ? params([c.param]) : "..."}) {`,
          ...block(c.body),
        ]),
        `${indent}}`,
      ];
    // A preprocessor line, at column 0 as they are written.
    case "line":
      return [`#line ${s.line} ${JSON.stringify(s.file)}`];
    case "comment":
      return s.text.split("\n").map((l) => `${indent}// ${l}`.trimEnd());
  }
}

// --- declarations ----------------------------------------------------------------------

export function decl(d: Decl, indent = ""): string[] {
  switch (d.k) {
    case "include": {
      const target = d.system ? `<${d.path}>` : `"${d.path}"`;
      return [`${indent}#${d.objc ? "import" : "include"} ${target}`];
    }
    case "pragmaOnce":
      return ["#pragma once"];
    case "namespace": {
      const name = d.name ? ` ${d.name}` : "";
      return [
        `${indent}namespace${name} {`,
        "",
        ...declList(d.body, indent),
        "",
        `${indent}}  // namespace${name}`,
      ];
    }
    case "usingNamespace":
      return [`${indent}using namespace ${d.name};`];
    case "function": {
      const template = templateHead(d.template, indent);
      const attrs = d.attributes?.length ? `[[${d.attributes.join(", ")}]] ` : "";
      const name = d.scope ? `${printType(d.scope)}::${d.name}` : d.name;
      const ret = d.ctor ? "" : `${printType(d.ret)} `;
      const head = `${template}${indent}${attrs}${d.static ? "static " : ""}${d.inline ? "inline " : ""}${ret}${name}(${params(d.params)})${d.const ? " const" : ""}`;
      if (!d.body) return [`${head};`];
      return [
        `${head}${initializers(d.initializers, indent)} {`,
        ...d.body.flatMap((x) => stmt(x, indent + INDENT)),
        `${indent}}`,
      ];
    }
    case "struct": {
      const kw = d.class ? "class" : "struct";
      const template = templateHead(d.template, indent);
      const name = d.args ? `${d.name}<${d.args.map(printTemplateArg).join(", ")}>` : d.name;
      if (d.forward) return [`${template}${indent}${kw} ${name};`];
      const bases = d.bases?.length
        ? ` : ${d.bases.map((b) => `${b.public ? "public " : ""}${b.virtual ? "virtual " : ""}${printType(b.type)}`).join(", ")}`
        : "";
      return [
        `${template}${indent}${kw} ${name}${d.final ? " final" : ""}${bases} {`,
        ...d.members.flatMap((m) => member(m, indent + INDENT)),
        `${indent}};`,
      ];
    }
    case "var":
      return stmt(d.stmt, indent).map((l, i) =>
        i === 0
          ? l.replace(/^(\s*)/, `$1${d.extern ? "extern " : ""}${d.inline ? "inline " : ""}`)
          : l,
      );
    case "using":
      return [`${indent}using ${d.name} = ${printType(d.type)};`];
    case "staticAssert":
      return [
        `${indent}static_assert(${expr(d.test, PREC.assign, indent)}, ${quoted(d.message)});`,
      ];
    case "externC":
      return [`${indent}extern "C" {`, ...declList(d.body, indent), `${indent}}`];
    case "objcInterface": {
      const protocols = d.protocols?.length ? ` <${d.protocols.join(", ")}>` : "";
      const head = `@interface ${d.name} : ${d.superclass}${protocols}`;
      if (!d.ivars?.length) return [head, "@end"];
      return [
        `${head} {`,
        "@public",
        ...d.ivars.map((v) => `${INDENT}${printType(v.type)} ${v.name};`),
        "}",
        "@end",
      ];
    }
    case "objcImplementation":
      return [`@implementation ${d.name}`, ...d.methods.flatMap(objcMethod), "@end"];
    // Preprocessor lines, at column 0 as they are written.
    case "withoutMacros": {
      if (!d.names.length) return declList(d.body, indent);

      const hide = d.names.flatMap((n) => [`#pragma push_macro("${n}")`, `#undef ${n}`]);
      const restore = d.names.toReversed().map((n) => `#pragma pop_macro("${n}")`);

      return [...hide, "", ...declList(d.body, indent), "", ...restore];
    }
    case "comment":
      return d.text.split("\n").map((l) => `${indent}// ${l}`.trimEnd());
    case "blank":
      return [""];
  }
}

/** Declarations kept together when one line each: includes, forward declarations, prototypes. */
const group = (d: Decl): string => (d.k === "pragmaOnce" ? "include" : d.k);

/**
 * Declarations one after another, a blank line between two where either
 * spans lines or they differ in kind; a comment stays with what follows it.
 */
function declList(decls: Decl[], indent: string): string[] {
  const out: string[] = [];
  let prev: { d: Decl; lines: number } | undefined;
  for (const d of decls) {
    const lines = decl(d, indent);
    const apart =
      prev &&
      prev.d.k !== "comment" &&
      prev.d.k !== "blank" &&
      d.k !== "blank" &&
      (prev.lines > 1 || lines.join("\n").includes("\n") || group(prev.d) !== group(d));
    if (apart) out.push("");
    out.push(...lines);
    // A template's head is part of its first line's text.
    prev = { d, lines: lines.join("\n").split("\n").length };
  }
  return out;
}

/** `template <class T, class U>` on a line of its own; `template <>` for a specialization. */
function templateHead(params: string[] | undefined, indent: string): string {
  return params ? `${indent}template <${params.map((t) => `class ${t}`).join(", ")}>\n` : "";
}

function member(m: Member, indent: string): string[] {
  switch (m.k) {
    case "field": {
      const init = m.init ? `{${expr(m.init, 0, indent)}}` : "{}";
      // A static member's initializer is in its definition, unless it is inline.
      const bare = m.static && !m.inline;
      return [
        `${indent}${m.static ? "static " : ""}${m.inline ? "inline " : ""}${printType(m.type)} ${m.name}${bare ? "" : init};`,
      ];
    }
    case "method": {
      const ret = m.ret ? `${printType(m.ret)} ` : "";
      const head = `${indent}${m.static ? "static " : ""}${m.virtual ? "virtual " : ""}${ret}${m.name}(${params(m.params)})${m.const ? " const" : ""}${m.override ? " override" : ""}`;
      if (m.pure) return [`${head} = 0;`];
      if (m.default) return [`${head} = default;`];
      if (!m.body) return [`${head};`];
      return [
        `${head}${initializers(m.initializers, indent)} {`,
        ...m.body.flatMap((x) => stmt(x, indent + INDENT)),
        `${indent}}`,
      ];
    }
    case "access":
      return [`${indent.slice(INDENT.length)} ${m.level}:`];
    case "using":
      return [`${indent}using ${m.name};`];
    case "comment":
      return m.text.split("\n").map((l) => `${indent}// ${l}`.trimEnd());
  }
}

/** A constructor's member initializers, ` : a(x), b(y)`, or nothing. */
function initializers(inits: { name: string; args: Expr[] }[] | undefined, indent: string) {
  if (!inits?.length) return "";

  return ` : ${inits.map((i) => `${i.name}(${i.args.map((a) => item(a, indent)).join(", ")})`).join(", ")}`;
}

function objcMethod(m: ObjcMethod): string[] {
  const sig = m.parts
    .map((p) => (p.param ? `${p.name}:(${printType(p.param.type)})${p.param.name}` : p.name))
    .join(" ");
  return [
    `${m.static ? "+" : "-"} (${printType(m.ret)})${sig} {`,
    ...m.body.flatMap((x) => stmt(x, INDENT)),
    "}",
  ];
}

// --- units -----------------------------------------------------------------------------

export function printUnit(u: Unit): string {
  const lines = [...(u.banner ? [`// ${u.banner}`] : []), ...declList(u.decls, "")];
  return `${lines.join("\n")}\n`;
}

export function printExpr(e: Expr): string {
  return expr(e, 0, "");
}

export function printDecls(decls: Decl[]): string {
  return declList(decls, "").join("\n");
}

export function printStmts(stmts: Stmt[], indent = ""): string {
  return stmts.flatMap((s) => stmt(s, indent)).join("\n");
}
