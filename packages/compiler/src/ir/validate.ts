import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { IRCallSemantics, IRExpr, IRModule, IRPlace, IRStmt } from "./types.ts";

/**
 * Validate HIR invariants after lowering (and after any later rewrite).
 * Backends must receive already-consistent ownership and effect metadata.
 */
export function validateHIR(module: IRModule): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const fn of module.functions) {
    const visit = (expr: IRExpr) => {
      if (expr.op !== "call") return;
      const issue = checkCallSemantics(expr.callee, expr.args.length, expr.semantics);
      if (issue) diagnostics.push(diagnostic("LUCENT1001", { start: 0, end: 0 }, issue));
    };
    walkStmts(fn.body, visit);
    for (const slot of fn.effectSlots ?? []) {
      walkStmts(slot.body, visit);
      walkStmts(slot.cleanup, visit);
    }
  }
  return diagnostics;
}

function checkCallSemantics(callee: string, argCount: number, semantics: IRCallSemantics): string | null {
  if (semantics.argumentOwnership.length !== argCount)
    return `HIR call \`${callee}\` has ${semantics.argumentOwnership.length} ownership entries for ${argCount} arguments.`;
  if (semantics.effects.async !== semantics.suspension)
    return `HIR call \`${callee}\` has inconsistent async/suspension flags.`;
  if (semantics.cancellation !== "none" && semantics.cancellation !== "cooperative")
    return `HIR call \`${callee}\` has an unknown cancellation policy.`;
  if (semantics.symbolId !== undefined && semantics.symbolId.length === 0)
    return `HIR call \`${callee}\` has an empty symbol identity.`;
  if (!semantics.effects.native && semantics.symbolId)
    return `HIR Lucent call \`${callee}\` must not carry a native symbol identity.`;
  return null;
}

function walkStmts(stmts: IRStmt[], visit: (expr: IRExpr) => void): void {
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
    case "closure":
      if (Array.isArray(expr.body)) walkStmts(expr.body, visit);
      else walkExpr(expr.body, visit);
      break;
    case "invoke":
      walkExpr(expr.callback, visit);
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    case "call":
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    case "view":
      for (const prop of expr.props) walkExpr(prop.value, visit);
      for (const child of expr.children) walkExpr(child, visit);
      break;
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      walkExpr(expr.value, visit);
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
    case "ifExpr":
      walkExpr(expr.cond, visit);
      walkExpr(expr.consequent, visit);
      walkExpr(expr.alternate, visit);
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
    case "stateWrite":
      walkExpr(expr.value, visit);
      break;
    case "move":
    case "copy":
      walkExpr(expr.value, visit);
      break;
    case "const":
    case "param":
    case "local":
    case "functionRef":
    case "weak":
    case "stateRead":
    case "resourceRead":
      break;
  }
}
