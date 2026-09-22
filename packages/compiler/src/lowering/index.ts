import type { TExpr, TStmt, TypedFunction, TypedModule } from "../checker/typed.ts";
import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { AssignOperator, BinaryOperator } from "../parser/surface.ts";
import { T, type NativeType } from "../types/native-type.ts";
import type {
  BinaryOp,
  IRExpr,
  IRFunction,
  IRLocal,
  IRModule,
  IRPlace,
  IRStateSlot,
  IRStmt,
  LocalId,
} from "../ir/types.ts";

export interface LowerResult {
  module: IRModule | null;
  diagnostics: Diagnostic[];
}

const BINARY_OPS: Readonly<Record<BinaryOperator, BinaryOp>> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "rem",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  "===": "eq",
  "!==": "ne",
};

const COMPOUND_OPS: Readonly<Record<Exclude<AssignOperator, "=">, BinaryOp>> = {
  "+=": "add",
  "-=": "sub",
  "*=": "mul",
  "/=": "div",
};

export function lowerModule(module: TypedModule): LowerResult {
  const diagnostics: Diagnostic[] = [];
  const functions = module.functions.map((fn) => new FunctionLowerer(fn, diagnostics).lower());
  const ir: IRModule = {
    ...(module.enums ? { enums: module.enums } : {}),
    ...(module.nativePackages ? { nativePackages: module.nativePackages } : {}),
    ...(module.views ? { views: module.views } : {}),
    name: module.name,
    structs: module.structs.map((s) => ({
      ...(s.reference ? { reference: s.reference } : {}),
      ...(s.union ? { union: s.union } : {}),
      name: s.name,
      exported: s.exported,
      fields: s.fields.map((f) => ({ name: f.name, type: f.type })),
    })),
    functions,
    events: functions
      .filter((f) => f.event)
      .map((f) => ({
        name: f.event!.name,
        id: f.event!.id,
        exported: f.event!.exported,
        payload: f.params[0]?.type ?? T.void,
      })),
    capabilities: [
      ...new Set([
        ...usedCapabilities(functions),
        ...Object.values(module.nativePackages ?? {}).flatMap((p) => p.capabilities ?? []),
      ]),
    ].toSorted(),
  };
  return { module: diagnostics.length ? null : ir, diagnostics };
}

class FunctionLowerer {
  private readonly locals: IRLocal[] = [];
  private readonly slots: IRStateSlot[] = [];
  private readonly state = new Map<string, NativeType>();
  /** Lexical scopes mapping source names to local ids; params live in the outermost one as `null`. */
  private readonly scopes: Map<string, LocalId | null>[] = [];
  private readonly used = new Map<string, number>();
  private readonly reassignedParams: Set<string>;

  constructor(
    private readonly fn: TypedFunction,
    private readonly diagnostics: Diagnostic[],
  ) {
    this.reassignedParams = collectAssignedNames(fn.body, new Set(fn.params.map((p) => p.name)));
  }

  lower(): IRFunction {
    this.scopes.push(new Map(this.fn.params.map((p) => [p.name, null])));
    const prologue: IRStmt[] = [];
    // Swift and Kotlin parameters are immutable: reassigned ones get a mutable local shadow.
    for (const p of this.fn.params) {
      if (!this.reassignedParams.has(p.name)) continue;
      const id = this.declare(p.name, p.type, true);
      prologue.push({ op: "let", id, value: { op: "param", name: p.name, type: p.type } });
    }
    const body = [...prologue, ...this.stmts(this.fn.body)];
    this.scopes.pop();
    // Value-typed targets (Swift arrays and structs) must be `var` when mutated in place.
    for (const id of collectMutatedLocals(body)) {
      const local = this.locals.find((l) => l.id === id);
      if (local) local.mutable = true;
    }
    return {
      name: this.fn.name,
      ...(this.fn.classOp ? { classOp: this.fn.classOp } : {}),
      ...(this.fn.event ? { event: this.fn.event } : {}),
      ...(this.fn.thread ? { thread: this.fn.thread } : {}),
      ...(this.fn.binding ? { binding: this.fn.binding } : {}),
      exported: this.fn.exported,
      async: this.fn.async,
      params: this.fn.params.map((p) => ({ name: p.name, type: p.type })),
      returnType: this.fn.returnType,
      locals: this.locals,
      body,
      ...(this.slots.length ? { state: this.slots } : {}),
    };
  }

  private declare(name: string, type: NativeType, mutable: boolean): LocalId {
    const n = this.used.get(name) ?? 0;
    this.used.set(name, n + 1);
    const id = n === 0 ? `%${name}` : `%${name}.${n}`;
    this.locals.push({ id, name, type, mutable });
    this.scopes[this.scopes.length - 1]!.set(name, id);
    return id;
  }

  private resolve(name: string): LocalId | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      if (scope.has(name)) return scope.get(name)!;
    }
    throw new Error(`lowering: unresolved identifier ${name}`);
  }

  private scoped<R>(f: () => R): R {
    this.scopes.push(new Map());
    try {
      return f();
    } finally {
      this.scopes.pop();
    }
  }

  private stmts(stmts: TStmt[]): IRStmt[] {
    return this.scoped(() => stmts.flatMap((s) => this.stmt(s)));
  }

  private stmt(s: TStmt): IRStmt[] {
    switch (s.kind) {
      case "variable": {
        if (s.init.kind === "stateInit") {
          const value = this.expr(s.init.value);
          if (value.op !== "const") {
            this.diagnostics.push(diagnostic("LUCENT1001", s.span, "`state()` requires a literal."));
            return [];
          }
          this.slots.push({ name: s.name, type: s.type, value: value.value });
          this.state.set(s.name, s.type);
          return [];
        }
        const value = this.expr(s.init);
        const id = this.declare(s.name, s.type, s.declaration === "let");
        return [{ op: "let", id, value }];
      }
      case "if":
        return [
          {
            op: "if",
            cond: this.expr(s.test),
            consequent: this.stmts(s.consequent),
            alternate: s.alternate ? this.stmts(s.alternate) : [],
          },
        ];
      case "while":
        return [{ op: "while", cond: this.expr(s.test), body: this.stmts(s.body) }];
      case "for":
        return this.forLoop(s);
      case "forOf":
        return this.scoped(() => {
          const iterable = this.expr(s.iterable);
          const id = this.declare(s.variable, s.elementType, false);
          return [{ op: "forEach", id, iterable, body: this.stmts(s.body) }];
        });
      case "return":
        return [{ op: "return", value: s.argument ? this.expr(s.argument) : null }];
      case "break":
      case "continue":
        return [{ op: s.kind }];
      case "throw":
        return [
          {
            op: "throw",
            code: s.code,
            message: s.message ? this.expr(s.message) : null,
            ...(s.metadata ? { metadata: s.metadata.map((f) => ({ name: f.name, value: this.expr(f.value) })) } : {}),
          },
        ];
      case "expression":
        return this.expressionStmt(s.expression);
      case "block":
        return this.stmts(s.body);
    }
  }

  private forLoop(s: Extract<TStmt, { kind: "for" }>): IRStmt[] {
    return this.scoped(() => {
      const init = s.init ? this.stmt(s.init) : [];
      const cond = s.test ? this.expr(s.test) : ({ op: "const", value: true, type: T.bool } as IRExpr);
      if (containsContinue(s.body)) {
        this.diagnostics.push(
          diagnostic(
            "LUCENT1001",
            s.span,
            "`continue` inside a C-style `for` loop is not supported yet.",
            "Use `while` with an explicit index, or `for…of`.",
          ),
        );
      }
      const update = s.update ? this.expressionStmt(s.update) : [];
      const body = [...this.stmts(s.body), ...update];
      return [...init, { op: "while", cond, body }];
    });
  }

  /** Assignments and updates are statements in the IR; anything else is evaluated for effect. */
  private expressionStmt(e: TExpr): IRStmt[] {
    if (e.kind === "stateWrite") return [{ op: "stateWrite", name: e.name, value: this.expr(e.value) }];
    if (e.kind === "assign") {
      const target = this.place(e.target);
      const value = this.expr(e.value);
      if (e.operator === "=") return [{ op: "assign", target, value }];
      const current = placeToExpr(target);
      const op = COMPOUND_OPS[e.operator];
      const combined: IRExpr =
        op === "add" && target.type.kind === "string"
          ? { op: "concat", parts: [current, value], type: T.string }
          : { op: "binary", operator: op, left: current, right: value, type: target.type };
      return [{ op: "assign", target, value: combined }];
    }
    if (e.kind === "update") {
      const target = this.place(e.target);
      const one: IRExpr = { op: "const", value: 1, type: target.type };
      return [
        {
          op: "assign",
          target,
          value: {
            op: "binary",
            operator: e.operator === "++" ? "add" : "sub",
            left: placeToExpr(target),
            right: one,
            type: target.type,
          },
        },
      ];
    }
    if (e.kind === "methodCall" && e.method === "push") {
      return [{ op: "push", array: this.expr(e.object), value: this.expr(e.args[0]!) }];
    }
    return [{ op: "expr", value: this.expr(e) }];
  }

  private place(e: TExpr): IRPlace {
    switch (e.kind) {
      case "identifier": {
        const id = this.resolve(e.name);
        if (id === null) throw new Error(`lowering: parameter ${e.name} assigned without a shadow local`);
        return { kind: "local", id, type: e.type };
      }
      case "member":
        return { kind: "field", object: this.expr(e.object), field: e.property, type: e.type };
      case "index":
        return { kind: "index", object: this.expr(e.object), index: this.expr(e.index), type: e.type };
      default:
        throw new Error(`lowering: ${e.kind} is not a place`);
    }
  }

  private expr(e: TExpr): IRExpr {
    const type = e.type;
    switch (e.kind) {
      case "view":
        return {
          op: "view",
          ...(e.native ? { native: e.native } : {}),
          name: e.name,
          props: e.properties.map((p) => ({ name: p.name, value: this.expr(p.value) })),
          children: e.children.map((c) => this.expr(c)),
          type: e.type,
        };
      case "number":
      case "string":
      case "boolean":
        return { op: "const", value: e.value, type };
      case "null":
        return { op: "const", value: null, type };
      case "template":
        return this.template(e);
      case "array":
        return { op: "array", elements: e.elements.map((x) => this.expr(x)), type };
      case "object":
        return {
          op: "struct",
          name: type.kind === "struct" ? type.name : "?",
          fields: e.properties.map((p) => ({ name: p.name, value: this.expr(p.value) })),
          type,
        };
      case "identifier": {
        if (this.state.has(e.name)) return { op: "stateRead", name: e.name, type };
        const id = this.resolve(e.name);
        return id === null ? { op: "param", name: e.name, type } : { op: "local", id, type };
      }
      case "stateInit":
        return this.expr(e.value);
      case "stateRead":
        return { op: "stateRead", name: e.name, type };
      case "stateWrite":
        return { op: "stateWrite", name: e.name, value: this.expr(e.value), type };
      case "conditional":
        return {
          op: "ifExpr",
          cond: this.expr(e.test),
          consequent: this.expr(e.consequent),
          alternate: this.expr(e.alternate),
          type,
        };
      case "weak":
        return { op: "weak", name: e.name, type };
      case "unwrap":
        return { op: "unwrap", value: this.expr(e.argument), type };
      case "binary": {
        const left = this.expr(e.left);
        const right = this.expr(e.right);
        if (e.operator === "+" && type.kind === "string") return { op: "concat", parts: [left, right], type };
        return { op: "binary", operator: BINARY_OPS[e.operator], left, right, type };
      }
      case "logical":
        return { op: e.operator === "&&" ? "and" : "or", left: this.expr(e.left), right: this.expr(e.right), type };
      case "unary":
        return { op: e.operator === "!" ? "not" : "neg", value: this.expr(e.argument), type };
      case "assign":
      case "update":
        this.diagnostics.push(
          diagnostic("LUCENT1001", e.span, "Assignments are only supported as statements, not inside expressions."),
        );
        return { op: "const", value: 0, type };
      case "closure": {
        this.scopes.push(new Map(e.params.map((p) => [p.name, null])));
        const body = Array.isArray(e.body) ? this.stmts(e.body) : this.expr(e.body);
        this.scopes.pop();
        return {
          op: "closure",
          params: e.params.map((p) => ({ name: p.name, type: p.type })),
          captures: e.captures,
          body,
          type,
        };
      }
      case "functionRef":
        return { op: "functionRef", name: e.name, type };
      case "invoke":
        return { op: "invoke", callback: this.expr(e.callback), args: e.args.map((a) => this.expr(a)), type };
      case "call":
        return { op: "call", callee: e.callee, args: e.args.map((a) => this.expr(a)), type };
      case "member":
        return { op: "field", object: this.expr(e.object), field: e.property, type };
      case "length":
        return { op: "length", object: this.expr(e.object), type };
      case "index":
        return e.object.type.kind === "map"
          ? { op: "mapGet", map: this.expr(e.object), key: this.expr(e.index), type }
          : { op: "index", object: this.expr(e.object), index: this.expr(e.index), type };
      case "methodCall":
        this.diagnostics.push(diagnostic("LUCENT1001", e.span, `\`${e.method}\` is only supported as a statement.`));
        return { op: "const", value: 0, type };
      case "await":
        return { op: "await", value: this.expr(e.argument), type };
    }
  }

  private template(e: Extract<TExpr, { kind: "template" }>): IRExpr {
    const parts: IRExpr[] = [];
    e.quasis.forEach((q, i) => {
      if (q !== "") parts.push({ op: "const", value: q, type: T.string });
      const x = e.expressions[i];
      if (x) {
        const value = this.expr(x);
        parts.push(x.type.kind === "string" ? value : { op: "str", value, type: T.string });
      }
    });
    return { op: "concat", parts, type: T.string };
  }
}

function placeToExpr(p: IRPlace): IRExpr {
  switch (p.kind) {
    case "local":
      return { op: "local", id: p.id, type: p.type };
    case "field":
      return { op: "field", object: p.object, field: p.field, type: p.type };
    case "index":
      return { op: "index", object: p.object, index: p.index, type: p.type };
  }
}

/** Names among `candidates` that are assigned or updated anywhere in `stmts` (ignoring shadowing, conservatively). */
function collectAssignedNames(stmts: TStmt[], candidates: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const visitExpr = (e: TExpr): void => {
    const mutated =
      e.kind === "assign" || e.kind === "update"
        ? e.target
        : e.kind === "methodCall" && e.method === "push"
          ? e.object
          : null;
    if (mutated) {
      const root = rootIdentifier(mutated);
      if (root && candidates.has(root)) found.add(root);
    }
    if (e.kind === "closure" && Array.isArray(e.body)) visit(e.body);
    for (const child of childrenOf(e)) visitExpr(child);
  };
  const visit = (list: TStmt[]): void => {
    for (const s of list) {
      switch (s.kind) {
        case "variable":
          visitExpr(s.init);
          break;
        case "if":
          visitExpr(s.test);
          visit(s.consequent);
          if (s.alternate) visit(s.alternate);
          break;
        case "while":
          visitExpr(s.test);
          visit(s.body);
          break;
        case "for":
          if (s.init) visit([s.init]);
          if (s.test) visitExpr(s.test);
          if (s.update) visitExpr(s.update);
          visit(s.body);
          break;
        case "forOf":
          visitExpr(s.iterable);
          visit(s.body);
          break;
        case "return":
          if (s.argument) visitExpr(s.argument);
          break;
        case "throw":
          if (s.message) visitExpr(s.message);
          for (const field of s.metadata ?? []) visitExpr(field.value);
          break;
        case "expression":
          visitExpr(s.expression);
          break;
        case "block":
          visit(s.body);
          break;
        default:
          break;
      }
    }
  };
  visit(stmts);
  return found;
}

/** Locals that are pushed into or whose fields/elements are assigned. */
function rootLocal(e: IRExpr): LocalId | null {
  if (e.op === "local") return e.id;
  if (e.op === "field" || e.op === "index") return rootLocal(e.object);
  return null;
}

function collectMutatedLocals(stmts: IRStmt[]): Set<LocalId> {
  const found = new Set<LocalId>();
  const visit = (list: IRStmt[]): void => {
    for (const s of list) {
      switch (s.op) {
        case "push": {
          const id = rootLocal(s.array);
          if (id) found.add(id);
          break;
        }
        case "assign": {
          const id = s.target.kind === "local" ? null : rootLocal(s.target.object);
          if (id) found.add(id);
          break;
        }
        case "if":
          visit(s.consequent);
          visit(s.alternate);
          break;
        case "while":
        case "forEach":
          visit(s.body);
          break;
        default:
          break;
      }
    }
  };
  visit(stmts);
  return found;
}

/** The identifier at the root of a place chain: `a`, `a.b`, `a[i].c` → `a`. */
function rootIdentifier(e: TExpr): string | null {
  if (e.kind === "identifier") return e.name;
  if (e.kind === "member" || e.kind === "index") return rootIdentifier(e.object);
  return null;
}

function childrenOf(e: TExpr): TExpr[] {
  switch (e.kind) {
    case "closure":
      return Array.isArray(e.body) ? [] : [e.body];
    case "template":
      return e.expressions;
    case "array":
      return e.elements;
    case "object":
      return e.properties.map((p) => p.value);
    case "unwrap":
    case "unary":
    case "await":
      return [e.argument];
    case "binary":
    case "logical":
    case "conditional":
      return e.kind === "conditional" ? [e.test, e.consequent, e.alternate] : [e.left, e.right];
    case "assign":
      return [e.target, e.value];
    case "update":
      return [e.target];
    case "view":
      return [...e.properties.map((p) => p.value), ...e.children];
    case "invoke":
      return [e.callback, ...e.args];
    case "call":
      return e.args;
    case "member":
    case "length":
      return [e.object];
    case "index":
      return [e.object, e.index];
    case "methodCall":
      return [e.object, ...e.args];
    case "stateInit":
    case "stateWrite":
      return [e.value];
    default:
      return [];
  }
}

/** True if a `continue` in `stmts` would target the enclosing loop (inner loops are skipped). */
function containsContinue(stmts: TStmt[]): boolean {
  return stmts.some((s) => {
    switch (s.kind) {
      case "continue":
        return true;
      case "if":
        return containsContinue(s.consequent) || (s.alternate !== null && containsContinue(s.alternate));
      case "block":
        return containsContinue(s.body);
      default:
        return false;
    }
  });
}

function usedCapabilities(functions: IRFunction[]): string[] {
  const byName = new Map(functions.map((f) => [f.name, f]));
  const pending = functions.filter((f) => f.exported).map((f) => f.name),
    seen = new Set<string>(),
    capabilities = new Set<string>();
  const calls = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(calls);
      return;
    }
    const value = node as Record<string, unknown>;
    if (value.op === "functionRef" && typeof value.name === "string") pending.push(value.name);
    if (value.op === "call" && typeof value.callee === "string") pending.push(value.callee);
    for (const [key, child] of Object.entries(value)) if (key !== "type") calls(child);
  };
  while (pending.length) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const fn = byName.get(name);
    if (!fn) continue;
    fn.binding?.capabilities?.forEach((c) => capabilities.add(c));
    calls(fn.body);
  }
  return [...capabilities].toSorted();
}
