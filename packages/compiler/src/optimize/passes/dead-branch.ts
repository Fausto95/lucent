import type { IRExpr, IRModule, IRStmt } from "../../ir/types.ts";

/**
 * After constant folding, eliminate `if` / `ifExpr` whose condition is a
 * boolean const. Conservative: only literal `true` / `false` consts — no
 * speculative rewriting of non-const conditions.
 */
export function deadBranchEliminate(module: IRModule): { module: IRModule; eliminated: number } {
  let eliminated = 0;
  const next: IRModule = {
    ...module,
    functions: module.functions.map((fn) => ({
      ...fn,
      body: elimStmts(fn.body, (n) => {
        eliminated += n;
      }),
      ...(fn.effectSlots
        ? {
            effectSlots: fn.effectSlots.map((slot) => ({
              ...slot,
              body: elimStmts(slot.body, (n) => {
                eliminated += n;
              }),
              cleanup: elimStmts(slot.cleanup, (n) => {
                eliminated += n;
              }),
            })),
          }
        : {}),
    })),
  };
  return { module: next, eliminated };
}

function elimStmts(stmts: IRStmt[], count: (n: number) => void): IRStmt[] {
  const out: IRStmt[] = [];
  for (const stmt of stmts) {
    const rewritten = elimStmt(stmt, count);
    if (rewritten === null) continue;
    if (Array.isArray(rewritten)) out.push(...rewritten);
    else out.push(rewritten);
  }
  return out;
}

function elimStmt(stmt: IRStmt, count: (n: number) => void): IRStmt | IRStmt[] | null {
  switch (stmt.op) {
    case "if": {
      const cond = elimExpr(stmt.cond, count);
      const consequent = elimStmts(stmt.consequent, count);
      const alternate = elimStmts(stmt.alternate, count);
      if (cond.op === "const" && typeof cond.value === "boolean") {
        count(1);
        return cond.value ? consequent : alternate;
      }
      return { ...stmt, cond, consequent, alternate };
    }
    case "while":
      return { ...stmt, cond: elimExpr(stmt.cond, count), body: elimStmts(stmt.body, count) };
    case "forEach":
      return { ...stmt, iterable: elimExpr(stmt.iterable, count), body: elimStmts(stmt.body, count) };
    case "let":
      return { ...stmt, value: elimExpr(stmt.value, count) };
    case "assign":
      return { ...stmt, value: elimExpr(stmt.value, count) };
    case "return":
      return stmt.value ? { ...stmt, value: elimExpr(stmt.value, count) } : stmt;
    case "throw":
      return {
        ...stmt,
        message: stmt.message ? elimExpr(stmt.message, count) : null,
        ...(stmt.metadata ? { metadata: stmt.metadata.map((f) => ({ ...f, value: elimExpr(f.value, count) })) } : {}),
      };
    case "expr":
    case "stateWrite":
      return { ...stmt, value: elimExpr(stmt.value, count) };
    case "push":
      return { ...stmt, array: elimExpr(stmt.array, count), value: elimExpr(stmt.value, count) };
    case "break":
    case "continue":
      return stmt;
  }
}

function elimExpr(expr: IRExpr, count: (n: number) => void): IRExpr {
  switch (expr.op) {
    case "ifExpr": {
      const cond = elimExpr(expr.cond, count);
      const consequent = elimExpr(expr.consequent, count);
      const alternate = elimExpr(expr.alternate, count);
      if (cond.op === "const" && typeof cond.value === "boolean") {
        count(1);
        return cond.value ? consequent : alternate;
      }
      return { ...expr, cond, consequent, alternate };
    }
    case "closure":
      return {
        ...expr,
        body: Array.isArray(expr.body) ? elimStmts(expr.body, count) : elimExpr(expr.body, count),
      };
    case "const":
    case "param":
    case "local":
    case "functionRef":
    case "weak":
    case "stateRead":
    case "resourceRead":
      return expr;
    case "move":
    case "copy":
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      return { ...expr, value: elimExpr(expr.value, count) };
    case "binary":
    case "and":
    case "or":
      return { ...expr, left: elimExpr(expr.left, count), right: elimExpr(expr.right, count) };
    case "concat":
      return { ...expr, parts: expr.parts.map((p) => elimExpr(p, count)) };
    case "call":
      return { ...expr, args: expr.args.map((a) => elimExpr(a, count)) };
    case "invoke":
      return {
        ...expr,
        callback: elimExpr(expr.callback, count),
        args: expr.args.map((a) => elimExpr(a, count)),
      };
    case "view":
      return {
        ...expr,
        props: expr.props.map((p) => ({ ...p, value: elimExpr(p.value, count) })),
        children: expr.children.map((c) => elimExpr(c, count)),
      };
    case "field":
    case "length":
      return { ...expr, object: elimExpr(expr.object, count) };
    case "index":
      return {
        ...expr,
        object: elimExpr(expr.object, count),
        index: elimExpr(expr.index, count),
      };
    case "mapGet":
      return {
        ...expr,
        map: elimExpr(expr.map, count),
        key: elimExpr(expr.key, count),
      };
    case "array":
      return { ...expr, elements: expr.elements.map((e) => elimExpr(e, count)) };
    case "struct":
      return {
        ...expr,
        fields: expr.fields.map((f) => ({ ...f, value: elimExpr(f.value, count) })),
      };
    case "stateWrite":
      return { ...expr, value: elimExpr(expr.value, count) };
  }
}
