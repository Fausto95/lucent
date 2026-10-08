import type { BinaryOp, Decl, Expr, Member, Param, Stmt, Type, Unit } from "./ast.ts";

const INDENT = "  ";

// --- types -----------------------------------------------------------------------------

/** Swift's escapes of the characters a string literal cannot hold as they are. */
const ESCAPES: Record<string, string> = {
  "\0": "\\0",
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  '"': '\\"',
  "'": "\\'",
};

/**
 * A Swift string literal of `s`: `\0 \\ \t \n \r \" \'`, other controls and
 * the line and paragraph separators as `\u{…}`, the rest as it is (a
 * backslash escaped, so `\(` never interpolates). A Swift String holds
 * Unicode scalars, which a lone surrogate is not: it becomes U+FFFD, as
 * it does when an NSString holding one bridges to String.
 */
export function quoted(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const escaped = ESCAPES[ch];
    if (escaped) out += escaped;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\\u{fffd}";
    else if (cp < 0x20 || cp === 0x7f || cp === 0x2028 || cp === 0x2029)
      out += `\\u{${cp.toString(16)}}`;
    else out += ch;
  }
  return `${out}"`;
}

export function printType(t: Type): string {
  switch (t.k) {
    case "named":
      return t.args?.length ? `${t.name}<${t.args.map(printType).join(", ")}>` : t.name;
    case "optional":
      return t.of.k === "cFunction" || t.of.k === "blockFunction" || t.of.k === "function"
        ? `(${printType(t.of)})?`
        : `${printType(t.of)}?`;
    case "array":
      return `[${printType(t.of)}]`;
    case "dictionary":
      return `[${printType(t.key)}: ${printType(t.value)}]`;
    case "cFunction":
      return `@convention(c) (${t.params.map(printType).join(", ")}) -> ${printType(t.ret)}`;
    case "blockFunction":
      return `@convention(block) (${t.params.map(printType).join(", ")}) -> ${printType(t.ret)}`;
    case "function":
      return `(${t.params.map(printType).join(", ")}) -> ${printType(t.ret)}`;
    case "opaque":
      return `some ${printType(t.of)}`;
  }
}

// --- expressions -----------------------------------------------------------------------

/**
 * Swift's precedence groups, higher binding tighter; `try` and `await` cover
 * all to their right, a prefix operator binds looser than a postfix one.
 */
const PREC = {
  effect: 1,
  assign: 2,
  ternary: 3,
  or: 4,
  and: 5,
  comparison: 6,
  nilCoalescing: 7,
  cast: 8,
  range: 9,
  addition: 10,
  prefix: 11,
  postfix: 12,
};

/** The side an operator's own group nests on without parentheses; none for a non-associative group. */
type Associativity = "left" | "right" | "none";

const BINARY: Record<BinaryOp, { prec: number; assoc: Associativity }> = {
  "||": { prec: PREC.or, assoc: "left" },
  "&&": { prec: PREC.and, assoc: "left" },
  "==": { prec: PREC.comparison, assoc: "none" },
  "!=": { prec: PREC.comparison, assoc: "none" },
  "<": { prec: PREC.comparison, assoc: "none" },
  ">": { prec: PREC.comparison, assoc: "none" },
  "??": { prec: PREC.nilCoalescing, assoc: "right" },
  "...": { prec: PREC.range, assoc: "none" },
  "+": { prec: PREC.addition, assoc: "left" },
};

function precedence(e: Expr): number {
  switch (e.k) {
    case "try":
    case "await":
      return PREC.effect;
    case "assign":
      return PREC.assign;
    case "conditional":
      return PREC.ternary;
    case "binary":
      return BINARY[e.op].prec;
    case "cast":
      return PREC.cast;
    case "number":
      return e.text.startsWith("-") ? PREC.prefix : PREC.postfix;
    default:
      return PREC.postfix;
  }
}

function expr(e: Expr, min: number, indent: string): string {
  const text = bare(e, indent);
  return precedence(e) < min ? `(${text})` : text;
}

const args = (as: { label?: string; value: Expr }[], indent: string) =>
  as.map((a) => `${a.label ? `${a.label}: ` : ""}${expr(a.value, PREC.assign, indent)}`).join(", ");

function bare(e: Expr, indent: string): string {
  switch (e.k) {
    case "name":
      return e.name;
    case "number":
      return e.text;
    case "string":
      return quoted(e.value);
    case "bool":
      return String(e.value);
    case "nil":
      return "nil";
    case "self":
      return "self";
    case "member":
      return `${expr(e.object, PREC.postfix, indent)}.${e.name}`;
    case "arrayLiteral":
      return `[${e.items.map((x) => expr(x, PREC.assign, indent)).join(", ")}]`;
    case "tupleLiteral":
      return `(${e.items.map((x) => expr(x, PREC.assign, indent)).join(", ")})`;
    case "dictionaryLiteral":
      if (!e.entries.length) return "[:]";
      return `[${e.entries.map((x) => `${expr(x.key, PREC.assign, indent)}: ${expr(x.value, PREC.assign, indent)}`).join(", ")}]`;
    case "index":
      return `${expr(e.object, PREC.postfix, indent)}[${expr(e.index, 0, indent)}]`;
    case "call": {
      const callee = expr(e.callee, PREC.postfix, indent);
      const trailing = e.trailing ? ` ${closure(e.trailing, indent)}` : "";
      if (e.trailing && !e.args.length) return `${callee}${trailing}`;
      return `${callee}(${args(e.args, indent)})${trailing}`;
    }
    case "closure":
      return closure(e, indent);
    case "cast":
      return `${expr(e.value, PREC.cast + 1, indent)} ${e.op} ${printType(e.type)}`;
    case "try":
      return `try ${expr(e.value, PREC.effect, indent)}`;
    case "await":
      return `await ${expr(e.value, PREC.effect, indent)}`;
    case "forceUnwrap":
      return `${expr(e.value, PREC.postfix, indent)}!`;
    case "binary": {
      const { prec, assoc } = BINARY[e.op];
      const left = expr(e.left, assoc === "left" ? prec : prec + 1, indent);
      const right = expr(e.right, assoc === "right" ? prec : prec + 1, indent);

      return `${left} ${e.op} ${right}`;
    }
    case "conditional":
      // Right-associative: a conditional on the left is parenthesized, one on the right is not.
      return `${expr(e.test, PREC.ternary + 1, indent)} ? ${expr(e.whenTrue, PREC.ternary + 1, indent)} : ${expr(e.whenFalse, PREC.ternary, indent)}`;
    case "assign":
      return `${expr(e.target, PREC.postfix, indent)} = ${expr(e.value, PREC.assign, indent)}`;
    case "addressOf":
      return `&${expr(e.value, PREC.postfix, indent)}`;
    case "available":
      return `#available(${e.platforms.join(", ")})`;
  }
}

/** A closure: on one line when it is one statement, its `return` left implicit. */
function closure(c: Expr & { k: "closure" }, indent: string): string {
  const signature = [...(c.attributes ?? []), c.params.join(", ")].filter(Boolean).join(" ");
  const head = signature ? ` ${signature} in` : "";
  const [only] = c.body;
  if (c.body.length === 1 && (only!.k === "return" || only!.k === "expr")) {
    const value = only!.k === "return" ? only!.value : only!.expr;
    return value ? `{${head} ${expr(value, 0, indent)} }` : `{${head} }`;
  }
  return `{${head}\n${block(c.body, indent + INDENT).join("\n")}\n${indent}}`;
}

export function printExpr(e: Expr): string {
  return expr(e, 0, "");
}

// --- statements ------------------------------------------------------------------------

function block(stmts: Stmt[], indent: string): string[] {
  return stmts.flatMap((s) => stmt(s, indent));
}

function stmt(s: Stmt, indent: string): string[] {
  const inner = (b: Stmt[]) => block(b, indent + INDENT);
  const e = (x: Expr) => expr(x, 0, indent);
  switch (s.k) {
    case "expr":
      return [`${indent}${e(s.expr)}`];
    case "let":
    case "var": {
      const type = s.type ? `: ${printType(s.type)}` : "";
      return [`${indent}${s.k} ${s.name}${type}${s.init ? ` = ${e(s.init)}` : ""}`];
    }
    case "return":
      return [`${indent}return${s.value ? ` ${e(s.value)}` : ""}`];
    case "throw":
      return [`${indent}throw ${e(s.value)}`];
    case "if": {
      const out = [`${indent}if ${e(s.test)} {`, ...inner(s.body)];
      if (s.orElse) out.push(`${indent}} else {`, ...inner(s.orElse));
      return [...out, `${indent}}`];
    }
    case "ifLet": {
      const out = [`${indent}if let ${s.name} = ${e(s.value)} {`, ...inner(s.body)];
      if (s.orElse) out.push(`${indent}} else {`, ...inner(s.orElse));
      return [...out, `${indent}}`];
    }
    case "ifCase":
      return [`${indent}if case ${s.pattern} = ${e(s.value)} {`, ...inner(s.body), `${indent}}`];
    case "guard":
      return [`${indent}guard ${e(s.test)} else {`, ...inner(s.orElse), `${indent}}`];
    case "do":
      return [
        `${indent}do {`,
        ...inner(s.body),
        `${indent}} catch {`,
        ...inner(s.catchBody),
        `${indent}}`,
      ];
    case "switch":
      return [
        `${indent}switch ${e(s.on)} {`,
        ...s.cases.flatMap((c) => [
          `${indent}${c.patterns[0] === "default" ? "default" : `case ${c.patterns.join(", ")}`}:`,
          ...inner(c.body),
        ]),
        `${indent}}`,
      ];
  }
}

// --- declarations ----------------------------------------------------------------------

const params = (ps: Param[]) =>
  ps
    .map(
      (p) =>
        `${p.external !== undefined ? `${p.external} ` : ""}${p.name}: ${printType(p.type)}${p.default ? ` = ${printExpr(p.default)}` : ""}`,
    )
    .join(", ");
const mods = (ms: string[]) => ms.map((m) => `${m} `).join("");

function func(d: Decl & { k: "func" }, indent: string): string[] {
  const effects = d.effects?.length ? ` ${d.effects.join(" ")}` : "";
  const ret = d.ret ? ` -> ${printType(d.ret)}` : "";
  return [
    ...(d.attributes ?? []).map((a) => `${indent}${a}`),
    `${indent}${mods(d.modifiers)}func ${d.name}(${params(d.params)})${effects}${ret} {`,
    ...block(d.body, indent + INDENT),
    `${indent}}`,
  ];
}

function member(m: Member, indent: string): string[] {
  switch (m.k) {
    case "var":
    case "let":
      return [
        `${indent}${mods(m.modifiers)}${m.k} ${m.name}: ${printType(m.type)}${m.init ? ` = ${expr(m.init, 0, indent)}` : ""}`,
      ];
    case "init":
      return [
        `${indent}${mods(m.modifiers)}init(${params(m.params)}) {`,
        ...block(m.body, indent + INDENT),
        `${indent}}`,
      ];
    case "deinit":
      return [`${indent}deinit {`, ...block(m.body, indent + INDENT), `${indent}}`];
    case "property": {
      const head = `${indent}${mods(m.modifiers)}var ${m.name}: ${printType(m.type)} {`;
      if (!m.set) return [head, ...block(m.get, indent + INDENT), `${indent}}`];

      const inner = indent + INDENT;
      return [
        head,
        `${inner}get {`,
        ...block(m.get, inner + INDENT),
        `${inner}}`,
        `${inner}set {`,
        ...block(m.set, inner + INDENT),
        `${inner}}`,
        `${indent}}`,
      ];
    }
    case "typealias":
      return [`${indent}typealias ${m.name} = ${printType(m.type)}`];
    case "func":
      return func({ ...m, k: "func" }, indent);
  }
}

function decl(d: Decl): string[] {
  switch (d.k) {
    case "import":
      return [`import ${d.module}`];
    case "comment":
      return d.text.split("\n").map((l) => `// ${l}`.trimEnd());
    case "verbatim":
      return d.text.split("\n");
    case "func":
      return func(d, "");
    case "class":
    case "struct": {
      const tps = d.k === "class" && d.typeParams?.length ? `<${d.typeParams.join(", ")}>` : "";
      const inherits = [
        ...(d.k === "class" && d.superclass ? [d.superclass] : []),
        ...(d.protocols ?? []),
      ];
      const sup = inherits.length ? `: ${inherits.map(printType).join(", ")}` : "";
      // Stored properties together, then a blank line before each function or initializer.
      const body = d.members.flatMap((m, i) => [
        ...(i && (m.k === "init" || m.k === "deinit" || m.k === "func" || m.k === "property")
          ? [""]
          : []),
        ...member(m, INDENT),
      ]);
      return [`${mods(d.modifiers)}${d.k} ${d.name}${tps}${sup} {`, ...body, "}"];
    }
  }
}

export function printUnit(u: Unit): string {
  const lines: string[] = u.banner ? [`// ${u.banner}`] : [];
  let prev: Decl | undefined;
  for (const d of u.decls) {
    // Imports together; a blank line around everything else.
    if (prev && !(prev.k === "import" && d.k === "import")) lines.push("");
    lines.push(...decl(d));
    prev = d;
  }
  return `${lines.join("\n")}\n`;
}
