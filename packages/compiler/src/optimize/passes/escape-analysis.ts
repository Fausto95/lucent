import type { IRExpr, IRModule, IRPlace, IRStmt, LocalId } from "../../ir/types.ts";

export type EscapeTag = "NoEscape" | "Escape";

/**
 * Conservative escape analysis stub: a local Escapes if it is passed to a call,
 * returned, or stored (assign / push / stateWrite). Everything else is NoEscape.
 * Log-only; does not rewrite IR.
 */
export function escapeAnalyze(module: IRModule): { tags: Map<string, EscapeTag>; log: string[] } {
  const tags = new Map<string, EscapeTag>();
  const log: string[] = [];

  for (const fn of module.functions) {
    const escaping = new Set<LocalId>();
    walkStmts(fn.body, escaping);
    for (const local of fn.locals) {
      const tag: EscapeTag = escaping.has(local.id) ? "Escape" : "NoEscape";
      tags.set(`${fn.name}.${local.id}`, tag);
      log.push(`escape-analysis: ${fn.name} ${local.id} ${tag}`);
    }
  }

  return { tags, log };
}

function walkStmts(stmts: IRStmt[], escaping: Set<LocalId>): void {
  for (const stmt of stmts) walkStmt(stmt, escaping);
}

function walkStmt(stmt: IRStmt, escaping: Set<LocalId>): void {
  switch (stmt.op) {
    case "let":
      // Initializer may contain calls that escape nested locals; the bound local
      // itself escapes only when used in a call/return/store later.
      scanForNestedEscapes(stmt.value, escaping);
      break;
    case "assign":
      markPlaceStore(stmt.target, escaping);
      markLocalLeaves(stmt.value, escaping);
      scanForNestedEscapes(stmt.value, escaping);
      break;
    case "if":
      scanForNestedEscapes(stmt.cond, escaping);
      walkStmts(stmt.consequent, escaping);
      walkStmts(stmt.alternate, escaping);
      break;
    case "while":
      scanForNestedEscapes(stmt.cond, escaping);
      walkStmts(stmt.body, escaping);
      break;
    case "forEach":
      scanForNestedEscapes(stmt.iterable, escaping);
      walkStmts(stmt.body, escaping);
      break;
    case "return":
      if (stmt.value) {
        markLocalLeaves(stmt.value, escaping);
        scanForNestedEscapes(stmt.value, escaping);
      }
      break;
    case "throw":
      if (stmt.message) {
        markLocalLeaves(stmt.message, escaping);
        scanForNestedEscapes(stmt.message, escaping);
      }
      for (const field of stmt.metadata ?? []) {
        markLocalLeaves(field.value, escaping);
        scanForNestedEscapes(field.value, escaping);
      }
      break;
    case "expr":
      scanForNestedEscapes(stmt.value, escaping);
      break;
    case "push":
      markLocalLeaves(stmt.array, escaping);
      markLocalLeaves(stmt.value, escaping);
      scanForNestedEscapes(stmt.array, escaping);
      scanForNestedEscapes(stmt.value, escaping);
      break;
    case "stateWrite":
      markLocalLeaves(stmt.value, escaping);
      scanForNestedEscapes(stmt.value, escaping);
      break;
    case "break":
    case "continue":
      break;
  }
}

function markPlaceStore(place: IRPlace, escaping: Set<LocalId>): void {
  if (place.kind === "local") escaping.add(place.id);
  else if (place.kind === "field" || place.kind === "index") markLocalLeaves(place.object, escaping);
}

/** Mark locals that appear as call/invoke arguments (escape via call). */
function scanForNestedEscapes(expr: IRExpr, escaping: Set<LocalId>): void {
  switch (expr.op) {
    case "call":
      for (const arg of expr.args) markLocalLeaves(arg, escaping);
      for (const arg of expr.args) scanForNestedEscapes(arg, escaping);
      return;
    case "invoke":
      markLocalLeaves(expr.callback, escaping);
      for (const arg of expr.args) markLocalLeaves(arg, escaping);
      scanForNestedEscapes(expr.callback, escaping);
      for (const arg of expr.args) scanForNestedEscapes(arg, escaping);
      return;
    case "closure":
      if (Array.isArray(expr.body)) walkStmts(expr.body, escaping);
      else scanForNestedEscapes(expr.body, escaping);
      return;
    case "local":
    case "const":
    case "param":
    case "functionRef":
    case "weak":
    case "stateRead":
    case "resourceRead":
      return;
    case "move":
    case "copy":
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      scanForNestedEscapes(expr.value, escaping);
      return;
    case "length":
      scanForNestedEscapes(expr.object, escaping);
      return;
    case "binary":
    case "and":
    case "or":
      scanForNestedEscapes(expr.left, escaping);
      scanForNestedEscapes(expr.right, escaping);
      return;
    case "concat":
      for (const part of expr.parts) scanForNestedEscapes(part, escaping);
      return;
    case "field":
      scanForNestedEscapes(expr.object, escaping);
      return;
    case "index":
      scanForNestedEscapes(expr.object, escaping);
      scanForNestedEscapes(expr.index, escaping);
      return;
    case "mapGet":
      scanForNestedEscapes(expr.map, escaping);
      scanForNestedEscapes(expr.key, escaping);
      return;
    case "array":
      for (const el of expr.elements) scanForNestedEscapes(el, escaping);
      return;
    case "struct":
      for (const field of expr.fields) scanForNestedEscapes(field.value, escaping);
      return;
    case "ifExpr":
      scanForNestedEscapes(expr.cond, escaping);
      scanForNestedEscapes(expr.consequent, escaping);
      scanForNestedEscapes(expr.alternate, escaping);
      return;
    case "stateWrite":
      scanForNestedEscapes(expr.value, escaping);
      return;
    case "view":
      for (const prop of expr.props) scanForNestedEscapes(prop.value, escaping);
      for (const child of expr.children) scanForNestedEscapes(child, escaping);
      return;
  }
}

function markLocalLeaves(expr: IRExpr, escaping: Set<LocalId>): void {
  switch (expr.op) {
    case "local":
      escaping.add(expr.id);
      return;
    case "const":
    case "param":
    case "functionRef":
    case "weak":
    case "stateRead":
    case "resourceRead":
      return;
    case "call":
      for (const arg of expr.args) markLocalLeaves(arg, escaping);
      return;
    case "invoke":
      markLocalLeaves(expr.callback, escaping);
      for (const arg of expr.args) markLocalLeaves(arg, escaping);
      return;
    case "closure":
      if (Array.isArray(expr.body)) walkStmts(expr.body, escaping);
      else markLocalLeaves(expr.body, escaping);
      return;
    case "move":
    case "copy":
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      markLocalLeaves(expr.value, escaping);
      return;
    case "length":
      markLocalLeaves(expr.object, escaping);
      return;
    case "binary":
    case "and":
    case "or":
      markLocalLeaves(expr.left, escaping);
      markLocalLeaves(expr.right, escaping);
      return;
    case "concat":
      for (const part of expr.parts) markLocalLeaves(part, escaping);
      return;
    case "field":
      markLocalLeaves(expr.object, escaping);
      return;
    case "index":
      markLocalLeaves(expr.object, escaping);
      markLocalLeaves(expr.index, escaping);
      return;
    case "mapGet":
      markLocalLeaves(expr.map, escaping);
      markLocalLeaves(expr.key, escaping);
      return;
    case "array":
      for (const el of expr.elements) markLocalLeaves(el, escaping);
      return;
    case "struct":
      for (const field of expr.fields) markLocalLeaves(field.value, escaping);
      return;
    case "ifExpr":
      markLocalLeaves(expr.cond, escaping);
      markLocalLeaves(expr.consequent, escaping);
      markLocalLeaves(expr.alternate, escaping);
      return;
    case "stateWrite":
      markLocalLeaves(expr.value, escaping);
      return;
    case "view":
      for (const prop of expr.props) markLocalLeaves(prop.value, escaping);
      for (const child of expr.children) markLocalLeaves(child, escaping);
      return;
  }
}
