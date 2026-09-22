import type { IRExpr, IRModule, IRPlace, IRStmt } from "@lucent-lang/compiler";

/** Static IR counts for `lucent build --analyze`. Not runtime measurements. */
export interface StaticEstimates {
  nativeCalls: number;
  asyncCalls: number;
  jsExports: number;
}

export function staticEstimates(modules: readonly IRModule[]): StaticEstimates {
  let nativeCalls = 0;
  let asyncCalls = 0;
  let jsExports = 0;
  for (const module of modules) {
    for (const fn of module.functions) {
      if (fn.exported) jsExports += 1;
      walkStmts(fn.body, (expr) => {
        if (expr.op !== "call") return;
        if (expr.semantics.effects.native) nativeCalls += 1;
        if (expr.semantics.effects.async) asyncCalls += 1;
      });
    }
  }
  return { nativeCalls, asyncCalls, jsExports };
}

function walkStmts(stmts: readonly IRStmt[], visit: (expr: IRExpr) => void): void {
  for (const stmt of stmts) {
    switch (stmt.op) {
      case "let":
        walkExpr(stmt.value, visit);
        break;
      case "assign":
        walkPlace(stmt.target, visit);
        walkExpr(stmt.value, visit);
        break;
      case "if":
        walkExpr(stmt.cond, visit);
        walkStmts(stmt.consequent, visit);
        walkStmts(stmt.alternate, visit);
        break;
      case "while":
        walkExpr(stmt.cond, visit);
        walkStmts(stmt.body, visit);
        break;
      case "forEach":
        walkExpr(stmt.iterable, visit);
        walkStmts(stmt.body, visit);
        break;
      case "return":
        if (stmt.value) walkExpr(stmt.value, visit);
        break;
      case "throw":
        if (stmt.message) walkExpr(stmt.message, visit);
        for (const field of stmt.metadata ?? []) walkExpr(field.value, visit);
        break;
      case "expr":
      case "stateWrite":
        walkExpr(stmt.value, visit);
        break;
      case "push":
        walkExpr(stmt.array, visit);
        walkExpr(stmt.value, visit);
        break;
      case "break":
      case "continue":
        break;
    }
  }
}

function walkPlace(place: IRPlace, visit: (expr: IRExpr) => void): void {
  switch (place.kind) {
    case "local":
      break;
    case "field":
      walkExpr(place.object, visit);
      break;
    case "index":
      walkExpr(place.object, visit);
      walkExpr(place.index, visit);
      break;
  }
}

function walkExpr(expr: IRExpr, visit: (expr: IRExpr) => void): void {
  visit(expr);
  switch (expr.op) {
    case "const":
    case "param":
    case "local":
    case "functionRef":
    case "weak":
    case "stateRead":
    case "resourceRead":
      break;
    case "closure":
      if (Array.isArray(expr.body)) walkStmts(expr.body, visit);
      else walkExpr(expr.body, visit);
      break;
    case "stateWrite":
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      walkExpr(expr.value, visit);
      break;
    case "ifExpr":
      walkExpr(expr.cond, visit);
      walkExpr(expr.consequent, visit);
      walkExpr(expr.alternate, visit);
      break;
    case "invoke":
      walkExpr(expr.callback, visit);
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    case "view":
      for (const prop of expr.props) walkExpr(prop.value, visit);
      for (const child of expr.children) walkExpr(child, visit);
      break;
    case "binary":
    case "and":
    case "or":
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case "concat":
      for (const part of expr.parts) walkExpr(part, visit);
      break;
    case "call":
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    case "field":
    case "length":
      walkExpr(expr.object, visit);
      break;
    case "index":
      walkExpr(expr.object, visit);
      walkExpr(expr.index, visit);
      break;
    case "mapGet":
      walkExpr(expr.map, visit);
      walkExpr(expr.key, visit);
      break;
    case "array":
      for (const element of expr.elements) walkExpr(element, visit);
      break;
    case "struct":
      for (const field of expr.fields) walkExpr(field.value, visit);
      break;
  }
}
