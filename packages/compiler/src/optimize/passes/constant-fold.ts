import { isNumeric } from "../../types/native-type.ts";
import type { IRExpr, IRModule, IRPlace, IRStmt } from "../../ir/types.ts";

/**
 * Fold `binary` add/sub/mul when both operands are numeric constants.
 * Conservative: only those three operators, only number const leaves.
 */
export function constantFold(module: IRModule): { module: IRModule; folded: number } {
  let folded = 0;
  const next: IRModule = {
    ...module,
    functions: module.functions.map((fn) => ({
      ...fn,
      body: foldStmts(fn.body, (n) => {
        folded += n;
      }),
    })),
  };
  return { module: next, folded };
}

function foldStmts(stmts: IRStmt[], count: (n: number) => void): IRStmt[] {
  return stmts.map((stmt) => foldStmt(stmt, count));
}

function foldStmt(stmt: IRStmt, count: (n: number) => void): IRStmt {
  switch (stmt.op) {
    case "let":
      return { ...stmt, value: foldExpr(stmt.value, count) };
    case "assign":
      return { ...stmt, target: foldPlace(stmt.target, count), value: foldExpr(stmt.value, count) };
    case "if":
      return {
        ...stmt,
        cond: foldExpr(stmt.cond, count),
        consequent: foldStmts(stmt.consequent, count),
        alternate: foldStmts(stmt.alternate, count),
      };
    case "while":
      return { ...stmt, cond: foldExpr(stmt.cond, count), body: foldStmts(stmt.body, count) };
    case "forEach":
      return {
        ...stmt,
        iterable: foldExpr(stmt.iterable, count),
        body: foldStmts(stmt.body, count),
      };
    case "return":
      return stmt.value ? { ...stmt, value: foldExpr(stmt.value, count) } : stmt;
    case "throw":
      return {
        ...stmt,
        message: stmt.message ? foldExpr(stmt.message, count) : null,
        ...(stmt.metadata ? { metadata: stmt.metadata.map((f) => ({ ...f, value: foldExpr(f.value, count) })) } : {}),
      };
    case "expr":
    case "stateWrite":
      return { ...stmt, value: foldExpr(stmt.value, count) };
    case "push":
      return { ...stmt, array: foldExpr(stmt.array, count), value: foldExpr(stmt.value, count) };
    case "break":
    case "continue":
      return stmt;
  }
}

function foldPlace(place: IRPlace, count: (n: number) => void): IRPlace {
  switch (place.kind) {
    case "local":
      return place;
    case "field":
      return { ...place, object: foldExpr(place.object, count) };
    case "index":
      return { ...place, object: foldExpr(place.object, count), index: foldExpr(place.index, count) };
  }
}

function foldExpr(expr: IRExpr, count: (n: number) => void): IRExpr {
  switch (expr.op) {
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
      return { ...expr, value: foldExpr(expr.value, count) };
    case "binary": {
      const left = foldExpr(expr.left, count);
      const right = foldExpr(expr.right, count);
      if (
        (expr.operator === "add" || expr.operator === "sub" || expr.operator === "mul") &&
        left.op === "const" &&
        right.op === "const" &&
        typeof left.value === "number" &&
        typeof right.value === "number" &&
        isNumeric(left.type) &&
        isNumeric(right.type) &&
        isNumeric(expr.type)
      ) {
        const value =
          expr.operator === "add"
            ? left.value + right.value
            : expr.operator === "sub"
              ? left.value - right.value
              : left.value * right.value;
        count(1);
        return { op: "const", value, type: expr.type };
      }
      return { ...expr, left, right };
    }
    case "closure":
      return {
        ...expr,
        body: Array.isArray(expr.body) ? foldStmts(expr.body, count) : foldExpr(expr.body, count),
      };
    case "stateWrite":
      return { ...expr, value: foldExpr(expr.value, count) };
    case "ifExpr":
      return {
        ...expr,
        cond: foldExpr(expr.cond, count),
        consequent: foldExpr(expr.consequent, count),
        alternate: foldExpr(expr.alternate, count),
      };
    case "invoke":
      return {
        ...expr,
        callback: foldExpr(expr.callback, count),
        args: expr.args.map((a) => foldExpr(a, count)),
      };
    case "view":
      return {
        ...expr,
        props: expr.props.map((p) => ({ ...p, value: foldExpr(p.value, count) })),
        children: expr.children.map((c) => foldExpr(c, count)),
      };
    case "widen":
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      return { ...expr, value: foldExpr(expr.value, count) };
    case "field":
    case "length":
      return { ...expr, object: foldExpr(expr.object, count) };
    case "concat":
      return { ...expr, parts: expr.parts.map((p) => foldExpr(p, count)) };
    case "and":
    case "or":
      return { ...expr, left: foldExpr(expr.left, count), right: foldExpr(expr.right, count) };
    case "call":
      return { ...expr, args: expr.args.map((a) => foldExpr(a, count)) };
    case "index":
      return {
        ...expr,
        object: foldExpr(expr.object, count),
        index: foldExpr(expr.index, count),
      };
    case "mapGet":
      return {
        ...expr,
        map: foldExpr(expr.map, count),
        key: foldExpr(expr.key, count),
      };
    case "array":
      return { ...expr, elements: expr.elements.map((e) => foldExpr(e, count)) };
    case "struct":
      return {
        ...expr,
        fields: expr.fields.map((f) => ({ ...f, value: foldExpr(f.value, count) })),
      };
  }
}
