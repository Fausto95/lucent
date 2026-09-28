import type { Annotation, ClassDecl, Expr, Member, Param, Stmt, Type, Unit } from "./ast.ts";

const INDENT = "  ";

// --- types -----------------------------------------------------------------------------

export function printType(t: Type): string {
  switch (t.k) {
    case "primitive":
      return t.name;
    case "class":
      return t.args?.length ? `${t.name}<${t.args.map(printType).join(", ")}>` : t.name;
    case "array":
      return `${printType(t.of)}[]`;
  }
}

// --- expressions -----------------------------------------------------------------------

/** Java's precedence levels, higher binding tighter. */
const PREC = {
  assign: 1,
  or: 3,
  and: 4,
  equality: 8,
  relational: 9,
  additive: 11,
  multiplicative: 12,
  unary: 14,
  postfix: 16,
} as const;

const BINARY: Record<string, number> = {
  "||": PREC.or,
  "&&": PREC.and,
  "==": PREC.equality,
  "!=": PREC.equality,
  "<": PREC.relational,
  ">": PREC.relational,
  "<=": PREC.relational,
  ">=": PREC.relational,
  "+": PREC.additive,
  "-": PREC.additive,
  "*": PREC.multiplicative,
  "/": PREC.multiplicative,
};

function precedence(e: Expr): number {
  switch (e.k) {
    case "assign":
      return PREC.assign;
    case "binary":
      return BINARY[e.op]!;
    case "unary":
    case "cast":
      return PREC.unary;
    default:
      return PREC.postfix;
  }
}

/** `e` where an operand of precedence `min` goes: parenthesized when it binds more loosely. */
function expr(e: Expr, min: number): string {
  const text = bare(e);
  return precedence(e) < min ? `(${text})` : text;
}

const list = (items: Expr[]) => items.map((a) => expr(a, PREC.assign)).join(", ");

function bare(e: Expr): string {
  switch (e.k) {
    case "name":
      return e.name;
    case "string":
      return JSON.stringify(e.value);
    case "number":
      return e.text;
    case "bool":
      return String(e.value);
    case "null":
      return "null";
    case "this":
      return "this";
    case "super":
      return "super";
    case "field":
      return `${expr(e.object, PREC.postfix)}.${e.name}`;
    case "call":
      return `${e.target ? `${expr(e.target, PREC.postfix)}.` : ""}${e.name}(${list(e.args)})`;
    case "new":
      return `new ${printType(e.type)}(${list(e.args)})`;
    case "newArray":
      return `new ${printType(e.type)}[] {${list(e.items)}}`;
    case "arrayInit":
      return `{${list(e.items)}}`;
    case "cast":
      return `(${printType(e.type)}) ${expr(e.operand, PREC.unary)}`;
    case "assign":
      return `${expr(e.target, PREC.postfix)} = ${expr(e.value, PREC.assign)}`;
    case "binary": {
      const p = BINARY[e.op]!;
      // Left-associative: a right operand of the same precedence keeps its parentheses.
      return `${expr(e.left, p)} ${e.op} ${expr(e.right, p + 1)}`;
    }
    case "unary":
      return `${e.op}${expr(e.operand, PREC.unary)}`;
  }
}

export function printExpr(e: Expr): string {
  return expr(e, 0);
}

// --- statements ------------------------------------------------------------------------

function stmt(s: Stmt, indent: string): string[] {
  const block = (body: Stmt[]) => body.flatMap((x) => stmt(x, indent + INDENT));
  switch (s.k) {
    case "expr":
      return [`${indent}${printExpr(s.expr)};`];
    case "var": {
      const head = `${s.final ? "final " : ""}${printType(s.type)} ${s.name}`;
      return [`${indent}${s.init ? `${head} = ${expr(s.init, PREC.assign)}` : head};`];
    }
    case "return":
      return [`${indent}${s.value ? `return ${printExpr(s.value)}` : "return"};`];
    case "throw":
      return [`${indent}throw ${printExpr(s.value)};`];
    case "if": {
      const out = [`${indent}if (${printExpr(s.test)}) {`, ...block(s.body)];
      if (s.orElse) out.push(`${indent}} else {`, ...block(s.orElse));
      return [...out, `${indent}}`];
    }
    case "try": {
      const out = [`${indent}try {`, ...block(s.body)];
      for (const c of s.catches ?? [])
        out.push(
          `${indent}} catch (${c.types.map(printType).join(" | ")} ${c.name}) {`,
          ...block(c.body),
        );
      if (s.finally) out.push(`${indent}} finally {`, ...block(s.finally));
      return [...out, `${indent}}`];
    }
    case "block":
      return [`${indent}{`, ...block(s.body), `${indent}}`];
  }
}

// --- declarations ----------------------------------------------------------------------

function doc(text: string | undefined, indent: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length === 1) return [`${indent}/** ${text} */`];
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`];
}

function annotations(as: Annotation[] | undefined, indent: string): string[] {
  return (as ?? []).map((a) => `${indent}@${a.name}${a.value ? `(${printExpr(a.value)})` : ""}`);
}

const modifiers = (ms: string[]) => ms.map((m) => `${m} `).join("");
const params = (ps: Param[]) =>
  ps.map((p) => `${p.final ? "final " : ""}${printType(p.type)} ${p.name}`).join(", ");
const throwsClause = (ts: Type[] | undefined) =>
  ts?.length ? ` throws ${ts.map(printType).join(", ")}` : "";

function member(m: Member, indent: string): string[] {
  const head = [...doc(m.doc, indent), ...annotations(m.annotations, indent)];
  const body = (b: Stmt[]) => b.flatMap((x) => stmt(x, indent + INDENT));
  switch (m.k) {
    case "field": {
      const init = m.init ? ` = ${expr(m.init, PREC.assign)}` : "";
      return [...head, `${indent}${modifiers(m.modifiers)}${printType(m.type)} ${m.name}${init};`];
    }
    case "constructor":
      return [
        ...head,
        `${indent}${modifiers(m.modifiers)}${m.name}(${params(m.params)})${throwsClause(m.throws)} {`,
        ...body(m.body),
        `${indent}}`,
      ];
    case "method": {
      const sig = `${indent}${modifiers(m.modifiers)}${printType(m.ret)} ${m.name}(${params(m.params)})${throwsClause(m.throws)}`;
      if (!m.body) return [...head, `${sig};`];
      return [...head, `${sig} {`, ...body(m.body), `${indent}}`];
    }
  }
}

function classDecl(c: ClassDecl, indent: string): string[] {
  const ext = c.extends ? ` extends ${printType(c.extends)}` : "";
  const impl = c.implements?.length ? ` implements ${c.implements.map(printType).join(", ")}` : "";
  // Members one blank line apart.
  const members = c.members.flatMap((m, i) => [...(i ? [""] : []), ...member(m, indent + INDENT)]);
  return [
    ...doc(c.doc, indent),
    ...annotations(c.annotations, indent),
    `${indent}${modifiers(c.modifiers)}class ${c.name}${ext}${impl} {`,
    ...members,
    `${indent}}`,
  ];
}

export function printUnit(u: Unit): string {
  const lines = [
    ...(u.banner ? [`// ${u.banner}`] : []),
    `package ${u.package};`,
    "",
    ...(u.imports.length ? [...u.imports.map((i) => `import ${i};`), ""] : []),
    ...u.types.flatMap((t, i) => [...(i ? [""] : []), ...classDecl(t, "")]),
  ];
  return `${lines.join("\n")}\n`;
}
