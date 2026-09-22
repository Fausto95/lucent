import { typeToString, type NativeType } from "../types/native-type.ts";
import type { IRCallSemantics, IRExpr, IRFunction, IRModule, IRPlace, IRStmt } from "./types.ts";

/** Text form of the IR, used by golden tests and `lucent build --emit-ir`. */
export function printIR(module: IRModule): string {
  const out: string[] = [`module ${module.name}`];
  for (const s of module.structs) {
    out.push(
      "",
      `${s.exported ? "export " : ""}struct ${s.name} { ${s.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ")} }`,
    );
  }
  for (const fn of module.functions) out.push("", ...printFunction(fn));
  return out.join("\n") + "\n";
}

function printEffects(fn: IRFunction): string {
  const effects = fn.effects;
  if (!effects || (!effects.native && !effects.async)) return "";
  const parts: string[] = [];
  if (effects.native) parts.push("native");
  if (effects.async) parts.push("async");
  if (effects.throws) parts.push("throws");
  if (effects.executor) parts.push(`exec=${effects.executor}`);
  return ` [${parts.join(" ")}]`;
}

function printFunction(fn: IRFunction): string[] {
  const params = fn.params.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ");
  const effects = printEffects(fn);
  const head = `${fn.exported ? "export " : ""}${fn.async ? "async " : ""}fn ${fn.name}(${params}) -> ${typeToString(fn.returnType)}${effects}`;
  const types = new Map(fn.locals.map((l) => [l.id, l.type]));
  const lines = [head];
  for (const slot of fn.state ?? [])
    lines.push(
      `  state ${slot.name}: ${typeToString(slot.type)} = ${expr({ op: "const", value: slot.value, type: slot.type })}`,
    );
  for (const slot of fn.resources ?? [])
    lines.push(
      `  resource slot ${slot.name}: ${typeToString(slot.type)} = (call ${slot.initCallee}) close ${slot.close}`,
    );
  for (const slot of fn.effectSlots ?? []) {
    lines.push(`  effect ${slot.id}${slot.async ? " async" : ""} deps [${slot.deps.join(", ")}]`);
    emitStmts(lines, slot.body, types, 2);
    if (slot.cleanup.length) {
      lines.push(`    cleanup`);
      emitStmts(lines, slot.cleanup, types, 3);
    }
  }
  emitStmts(lines, fn.body, types, 1);
  return lines;
}

function emitStmts(lines: string[], stmts: IRStmt[], types: Map<string, NativeType>, depth: number): void {
  const pad = "  ".repeat(depth);
  for (const s of stmts) {
    switch (s.op) {
      case "let":
        lines.push(`${pad}let ${s.id}: ${typeToString(types.get(s.id)!)} = ${expr(s.value)}`);
        break;
      case "assign":
        lines.push(`${pad}assign ${place(s.target)} = ${expr(s.value)}`);
        break;
      case "if":
        lines.push(`${pad}if ${expr(s.cond)}`);
        emitStmts(lines, s.consequent, types, depth + 1);
        if (s.alternate.length) {
          lines.push(`${pad}else`);
          emitStmts(lines, s.alternate, types, depth + 1);
        }
        break;
      case "while":
        lines.push(`${pad}while ${expr(s.cond)}`);
        emitStmts(lines, s.body, types, depth + 1);
        break;
      case "forEach":
        lines.push(`${pad}foreach ${s.id}: ${typeToString(types.get(s.id)!)} in ${expr(s.iterable)}`);
        emitStmts(lines, s.body, types, depth + 1);
        break;
      case "break":
      case "continue":
        lines.push(`${pad}${s.op}`);
        break;
      case "return":
        lines.push(`${pad}return${s.value ? " " + expr(s.value) : ""}`);
        break;
      case "throw":
        lines.push(
          `${pad}throw ${JSON.stringify(s.code)}${s.message ? " " + expr(s.message) : ""}${s.metadata ? " metadata { " + s.metadata.map((f) => f.name + ": " + expr(f.value)).join(", ") + " }" : ""}`,
        );
        break;
      case "expr":
        lines.push(`${pad}${expr(s.value)}`);
        break;
      case "push":
        lines.push(`${pad}push ${expr(s.array)} ${expr(s.value)}`);
        break;
      case "stateWrite":
        lines.push(`${pad}state ${s.name} = ${expr(s.value)}`);
        break;
    }
  }
}

function place(p: IRPlace): string {
  switch (p.kind) {
    case "local":
      return p.id;
    case "field":
      return `(field ${expr(p.object)} ${p.field})`;
    case "index":
      return `(index ${expr(p.object)} ${expr(p.index)})`;
  }
}

export function expr(e: IRExpr): string {
  switch (e.op) {
    case "view":
      return `(view ${e.name} ${e.props.map((p) => `${p.name}=${expr(p.value)}`).join(" ")} ${e.children.map(expr).join(" ")})`;
    case "const":
      return typeof e.value === "string" ? JSON.stringify(e.value) : String(e.value);
    case "param":
      return e.name;
    case "local":
      return e.id;
    case "widen":
      return `(widen ${typeToString(e.type)} ${expr(e.value)})`;
    case "unwrap":
    case "str":
    case "not":
    case "neg":
    case "await":
      return `(${e.op} ${expr(e.value)})`;
    case "binary":
      return `(${e.operator} ${expr(e.left)} ${expr(e.right)})`;
    case "concat":
      return `(concat ${e.parts.map(expr).join(" ")})`;
    case "and":
    case "or":
      return `(${e.op} ${expr(e.left)} ${expr(e.right)})`;
    case "weak":
      return `(weak ${e.name})`;
    case "move":
    case "copy":
      return `(${e.op} ${expr(e.value)})`;
    case "stateRead":
      return `(state ${e.name})`;
    case "resourceRead":
      return `(resource ${e.name})`;
    case "stateWrite":
      return `(set ${e.name} ${expr(e.value)})`;
    case "ifExpr":
      return `(if ${expr(e.cond)} ${expr(e.consequent)} ${expr(e.alternate)})`;
    case "closure": {
      const captures = e.captures.length ? ` [${e.captures.map((c) => `${c.kind} ${c.name}`).join(", ")}]` : "";
      const body = Array.isArray(e.body) ? "block" : expr(e.body);
      return `closure (${e.params.map((p) => p.name).join(", ")})${captures} => ${body}`;
    }
    case "functionRef":
      return `function_ref ${e.name}`;
    case "invoke":
      return `invoke ${expr(e.callback)}(${e.args.map(expr).join(", ")})`;
    case "call": {
      const args = e.args.map((a) => " " + expr(a)).join("");
      const sem = printSemantics(e.semantics);
      return `(call ${e.callee}${sem}${args})`;
    }
    case "field":
      return `(field ${expr(e.object)} ${e.field})`;
    case "length":
      return `(length ${expr(e.object)})`;
    case "index":
      return `(index ${expr(e.object)} ${expr(e.index)})`;
    case "mapGet":
      return `(mapget ${expr(e.map)} ${expr(e.key)})`;
    case "array":
      return `(array${e.elements.map((a) => " " + expr(a)).join("")})`;
    case "struct":
      return `(struct ${e.name}${e.fields.map((f) => ` (${f.name} ${expr(f.value)})`).join("")})`;
  }
}

function printSemantics(semantics: IRCallSemantics): string {
  const parts: string[] = [];
  if (semantics.symbolId) parts.push(`#${semantics.symbolId}`);
  parts.push(`${semantics.argumentOwnership.join(",") || "_"}->${semantics.resultOwnership}`);
  if (semantics.effects.async) parts.push("async");
  if (semantics.effects.native) parts.push("native");
  if (semantics.effects.executor) parts.push(`exec=${semantics.effects.executor}`);
  if (semantics.cancellation !== "none") parts.push(`cancel=${semantics.cancellation}`);
  return ` {${parts.join(" ")}}`;
}
