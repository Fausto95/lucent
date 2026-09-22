import type { IRExpr, IRModule, IRStmt } from "../../ir/types.ts";

/**
 * Remove standalone `expr` statements whose value is a pure const.
 * Very conservative: does not touch lets, calls, or any non-const expression.
 */
export function deadCodeEliminate(module: IRModule): { module: IRModule; removed: number } {
  let removed = 0;
  const next: IRModule = {
    ...module,
    functions: module.functions.map((fn) => ({
      ...fn,
      body: dceStmts(fn.body, (n) => {
        removed += n;
      }),
    })),
  };
  return { module: next, removed };
}

function dceStmts(stmts: IRStmt[], count: (n: number) => void): IRStmt[] {
  const out: IRStmt[] = [];
  for (const stmt of stmts) {
    const rewritten = dceStmt(stmt, count);
    if (rewritten === null) {
      count(1);
      continue;
    }
    out.push(rewritten);
  }
  return out;
}

function dceStmt(stmt: IRStmt, count: (n: number) => void): IRStmt | null {
  switch (stmt.op) {
    case "expr":
      return isPureConst(stmt.value) ? null : stmt;
    case "if":
      return {
        ...stmt,
        consequent: dceStmts(stmt.consequent, count),
        alternate: dceStmts(stmt.alternate, count),
      };
    case "while":
      return { ...stmt, body: dceStmts(stmt.body, count) };
    case "forEach":
      return { ...stmt, body: dceStmts(stmt.body, count) };
    case "let":
    case "assign":
    case "return":
    case "throw":
    case "push":
    case "stateWrite":
    case "break":
    case "continue":
      return walkNestedClosures(stmt, count);
  }
}

/** Closures can nest statement bodies; strip dead const exprs inside them too. */
function walkNestedClosures(stmt: IRStmt, count: (n: number) => void): IRStmt {
  switch (stmt.op) {
    case "let":
      return { ...stmt, value: dceInExpr(stmt.value, count) };
    case "assign":
      return { ...stmt, value: dceInExpr(stmt.value, count) };
    case "return":
      return stmt.value ? { ...stmt, value: dceInExpr(stmt.value, count) } : stmt;
    case "throw":
      return {
        ...stmt,
        message: stmt.message ? dceInExpr(stmt.message, count) : null,
        ...(stmt.metadata ? { metadata: stmt.metadata.map((f) => ({ ...f, value: dceInExpr(f.value, count) })) } : {}),
      };
    case "push":
      return {
        ...stmt,
        array: dceInExpr(stmt.array, count),
        value: dceInExpr(stmt.value, count),
      };
    case "stateWrite":
      return { ...stmt, value: dceInExpr(stmt.value, count) };
    default:
      return stmt;
  }
}

function dceInExpr(expr: IRExpr, count: (n: number) => void): IRExpr {
  if (expr.op !== "closure") return expr;
  if (Array.isArray(expr.body)) return { ...expr, body: dceStmts(expr.body, count) };
  return { ...expr, body: dceInExpr(expr.body, count) };
}

function isPureConst(expr: IRExpr): boolean {
  return expr.op === "const";
}
