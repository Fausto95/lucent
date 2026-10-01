/**
 * A readable listing of an IR function, for tests and internal errors:
 * each region nested under the operation owning it, and any region no
 * operation reaches listed after the body.
 */
import { typeKey } from "../types.ts";
import {
  type Callee,
  type IrFunction,
  type IrOp,
  type IrRegion,
  regionsOf,
  type SourceSpan,
  type ValueId,
} from "./ir.ts";

export function dump(fn: IrFunction): string {
  const type = (v: ValueId) => {
    const value = fn.values[v];

    return value ? typeKey(value.type) : "?";
  };
  const params = fn.params.map((p) => `v${p}: ${type(p)}`).join(", ");
  const effects = Object.entries(fn.effects)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  const lines = [
    `fn ${fn.id}(${params}) -> ${typeKey(fn.result)}${fn.async ? " async" : ""} ${at(fn.source)}`,
    `  effects ${effects}`,
    ...fn.modulePlaces.map(
      (p) =>
        `  module p${p.place} ${p.name}: ${typeKey(p.type)} = ${p.symbol}${p.mutable ? "" : " const"}`,
    ),
    ...fn.captures.map(
      (c) => `  capture p${c.place} ${c.name}: ${typeKey(c.type)}${c.boxed ? " boxed" : ""}`,
    ),
  ];

  const shown = new Set<IrRegion>();
  const listing = (region: IrRegion, indent: string, parent = ""): string[] => {
    shown.add(region);

    return [
      `${indent}r${region.id}${parent}:`,
      ...region.ops.flatMap((op) => [
        `${indent}  ${dumpOp(op, type)}  ${at(op.source)}`,
        // A closure's function, nested under it.
        ...(op.kind === "closure"
          ? dump(op.fn)
              .trimEnd()
              .split("\n")
              .map((l) => `${indent}    ${l}`)
          : []),
        ...regionsOf(op).flatMap((id) => {
          const owned = fn.regions[id];

          // Malformed IR can own a region twice or own one that does not exist.
          return owned && !shown.has(owned) ? listing(owned, `${indent}    `) : [];
        }),
      ]),
    ];
  };
  const body = fn.regions[fn.body];

  if (body) lines.push(...listing(body, "  "));

  for (const region of fn.regions)
    if (!shown.has(region))
      lines.push(
        ...listing(region, "  ", region.parent === undefined ? "" : ` (in r${region.parent})`),
      );

  return `${lines.join("\n")}\n`;
}

function dumpOp(op: IrOp, type: (v: ValueId) => string): string {
  const def = (v: ValueId, text: string) => `v${v} = ${text} : ${type(v)}`;
  const list = (vs: ValueId[]) => vs.map((v) => `v${v}`).join(", ");

  switch (op.kind) {
    case "const":
      return def(
        op.result,
        `const ${op.value === undefined ? "undefined" : typeof op.value === "bigint" ? `${op.value}n` : JSON.stringify(op.value)}`,
      );
    case "param":
      return def(op.result, `param ${op.index}`);
    case "unary":
      return def(op.result, `${op.op} v${op.operand}`);
    case "binary":
      return def(op.result, `v${op.left} ${op.op} v${op.right}`);
    case "convert":
      return def(op.result, `convert v${op.input}`);
    case "local":
      return `local p${op.place} ${op.name}: ${typeKey(op.type)}${op.boxed ? " boxed" : ""}`;
    case "load":
      return def(op.result, `load p${op.place}`);
    case "store":
      return `store p${op.place} = v${op.value}`;
    case "call": {
      const text = `call ${callee(op.callee)}(${list(op.args)}) throws=${op.effects.throws}`;

      return op.result === undefined ? text : def(op.result, text);
    }
    case "plan": {
      const text = `plan ${JSON.stringify(op.name)}(${list(op.args)})`;

      return op.result === undefined ? text : def(op.result, text);
    }
    case "closure": {
      const from = op.from.map((f) => ("value" in f ? `v${f.value}` : `box p${f.box}`));

      return def(op.result, `closure ${op.fn.id}(${from.join(", ")})`);
    }
    case "unreachable":
      return "unreachable";
    case "never":
      return def(op.result, "never");
    case "return":
      return op.value === undefined ? "return" : `return v${op.value}`;
    case "throw":
      return `throw v${op.value}`;
    case "if": {
      const text = `if v${op.cond} then r${op.whenTrue} else r${op.whenFalse}`;

      return op.result === undefined ? text : def(op.result, text);
    }
    case "loop":
      return `loop t${op.target} body r${op.body}${op.next === undefined ? "" : ` next r${op.next}`}`;
    case "block":
      return `block${op.target === undefined ? "" : ` t${op.target}`} r${op.body}`;
    case "iterate":
      return `iterate t${op.target} v${op.iterable} as v${op.element}: ${type(op.element)} body r${op.body}`;
    case "break":
      return `break t${op.target}`;
    case "continue":
      return `continue t${op.target}`;
    case "yield":
      return op.value === undefined ? "yield" : `yield v${op.value}`;
    default:
      // Malformed IR is dumped too: the verifier shows it in its error.
      return `<unknown operation ${JSON.stringify(op)}>`;
  }
}

function callee(c: Callee): string {
  return c.kind === "function" ? c.id : `builtin "${c.name}"`;
}

function at(s: SourceSpan): string {
  return `@${s.line}:${s.column}`;
}
