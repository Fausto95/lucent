import type { IRExpr, IRModule, IRStmt } from "../../ir/types.ts";

export interface ReachabilityResult {
  module: IRModule;
  unreachable: string[];
  removed: number;
  log: string[];
}

/**
 * Remove non-exported functions that are unreachable from any entry point
 * (exported functions, events, classOps). Entry points and anything they
 * call — including view trees and functionRef callbacks — stay. Safe: never
 * deletes a function that appears in the call graph from those roots.
 */
export function reachabilityEliminate(module: IRModule): ReachabilityResult {
  const byName = new Map(module.functions.map((fn) => [fn.name, fn]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const fn of module.functions) {
    if (fn.exported || fn.event || fn.classOp) {
      reachable.add(fn.name);
      queue.push(fn.name);
    }
  }

  while (queue.length) {
    const name = queue.pop()!;
    const fn = byName.get(name);
    if (!fn) continue;
    const callees = new Set<string>();
    collectCallees(fn.body, callees);
    for (const slot of fn.effectSlots ?? []) {
      collectCallees(slot.body, callees);
      collectCallees(slot.cleanup, callees);
    }
    for (const callee of callees) {
      if (!reachable.has(callee) && byName.has(callee)) {
        reachable.add(callee);
        queue.push(callee);
      }
    }
  }

  const unreachable = module.functions.filter((fn) => !reachable.has(fn.name)).map((fn) => fn.name);
  const kept = module.functions.filter((fn) => reachable.has(fn.name));
  const removed = module.functions.length - kept.length;
  const log = unreachable.map((name) => `reachability: removed unreachable non-exported function ${name}`);
  return {
    module: removed === 0 ? module : { ...module, functions: kept },
    unreachable,
    removed,
    log,
  };
}

/** @deprecated Prefer {@link reachabilityEliminate}; kept for log-only callers. */
export function reachabilityAnalyze(module: IRModule): { unreachable: string[]; log: string[] } {
  const result = reachabilityEliminate(module);
  return {
    unreachable: result.unreachable,
    log: result.unreachable.map((name) => `reachability: unreachable non-exported function ${name}`),
  };
}

function collectCallees(stmts: IRStmt[], callees: Set<string>): void {
  for (const stmt of stmts) collectStmtCallees(stmt, callees);
}

function collectStmtCallees(stmt: IRStmt, callees: Set<string>): void {
  switch (stmt.op) {
    case "let":
      collectExprCallees(stmt.value, callees);
      break;
    case "assign":
      collectExprCallees(stmt.value, callees);
      break;
    case "if":
      collectExprCallees(stmt.cond, callees);
      collectCallees(stmt.consequent, callees);
      collectCallees(stmt.alternate, callees);
      break;
    case "while":
      collectExprCallees(stmt.cond, callees);
      collectCallees(stmt.body, callees);
      break;
    case "forEach":
      collectExprCallees(stmt.iterable, callees);
      collectCallees(stmt.body, callees);
      break;
    case "return":
      if (stmt.value) collectExprCallees(stmt.value, callees);
      break;
    case "throw":
      if (stmt.message) collectExprCallees(stmt.message, callees);
      for (const field of stmt.metadata ?? []) collectExprCallees(field.value, callees);
      break;
    case "expr":
      collectExprCallees(stmt.value, callees);
      break;
    case "push":
      collectExprCallees(stmt.array, callees);
      collectExprCallees(stmt.value, callees);
      break;
    case "stateWrite":
      collectExprCallees(stmt.value, callees);
      break;
    case "break":
    case "continue":
      break;
  }
}

function collectExprCallees(expr: IRExpr, callees: Set<string>): void {
  switch (expr.op) {
    case "call":
      callees.add(expr.callee);
      for (const arg of expr.args) collectExprCallees(arg, callees);
      return;
    case "functionRef":
      callees.add(expr.name);
      return;
    case "invoke":
      collectExprCallees(expr.callback, callees);
      for (const arg of expr.args) collectExprCallees(arg, callees);
      return;
    case "closure":
      if (Array.isArray(expr.body)) collectCallees(expr.body, callees);
      else collectExprCallees(expr.body, callees);
      return;
    case "local":
    case "const":
    case "param":
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
      collectExprCallees(expr.value, callees);
      return;
    case "length":
      collectExprCallees(expr.object, callees);
      return;
    case "binary":
    case "and":
    case "or":
      collectExprCallees(expr.left, callees);
      collectExprCallees(expr.right, callees);
      return;
    case "concat":
      for (const part of expr.parts) collectExprCallees(part, callees);
      return;
    case "field":
      collectExprCallees(expr.object, callees);
      return;
    case "index":
      collectExprCallees(expr.object, callees);
      collectExprCallees(expr.index, callees);
      return;
    case "mapGet":
      collectExprCallees(expr.map, callees);
      collectExprCallees(expr.key, callees);
      return;
    case "array":
      for (const el of expr.elements) collectExprCallees(el, callees);
      return;
    case "struct":
      for (const field of expr.fields) collectExprCallees(field.value, callees);
      return;
    case "ifExpr":
      collectExprCallees(expr.cond, callees);
      collectExprCallees(expr.consequent, callees);
      collectExprCallees(expr.alternate, callees);
      return;
    case "stateWrite":
      collectExprCallees(expr.value, callees);
      return;
    case "view":
      for (const prop of expr.props) collectExprCallees(prop.value, callees);
      for (const child of expr.children) collectExprCallees(child, callees);
      return;
  }
}
