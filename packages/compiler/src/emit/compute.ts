/**
 * `compute(task, input, { signal })` from lucent:core: a function run on the
 * runtime's compute pool (lucent/compute.h). The program analyses check
 * that the task can run on a worker and that its input and result are
 * data; the task then lowers to
 *
 * - a task entry, one per function a module computes: a static TaskEntry
 *   whose input is a tuple of the task's arguments;
 * - a task variant of the function, and of every module function it calls
 *   directly, taking the TaskContext: each loop iteration is a safepoint
 *   (checkCancelled), so cancelling a running task stops it there;
 * - a Transport for each struct and class its input holds (transportObject),
 *   so the input is copied at submission with its aliases and cycles.
 *
 * The task is submitted under the module scope, which a reload of the
 * JavaScript runtime disposes. lucent/compute.h is included only by the
 * modules that compute or have task variants.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { programFacts, type ProgramFacts } from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule, LucentProgram } from "../program.ts";
import { cppIdent, type LType, substitute, T, typeKey, unionOf } from "../types.ts";
import { argMap, memberName, parameterProperties } from "./classes.ts";
import type { Ctx, E, Global } from "./context.ts";
import { movedByInput, refuseLaterUse } from "./buffers.ts";
import { isCoreSymbol } from "./core.ts";
import { FnEmitter } from "./function.ts";

type FunctionGlobal = Extract<Global, { kind: "function" }>;

/** What one program's compute calls need: its facts, and the task variants asked for. */
interface ComputeState {
  readonly lp: LucentProgram;
  facts?: ProgramFacts;
  /** Variants by function, in the order asked for; `emitted` once their code exists. */
  readonly variants: Map<ts.FunctionDeclaration, { g: FunctionGlobal; emitted: boolean }>;
}

const states = new WeakMap<Ctx, ComputeState>();

/** Makes `lp`'s facts and task variants available to the emitters of `ctx`. */
export function bindCompute(ctx: Ctx, lp: LucentProgram): void {
  states.set(ctx, { lp, variants: new Map() });
}

function stateOf(ctx: Ctx): ComputeState {
  const state = states.get(ctx);
  if (!state) throw new Error("compute lowering without bindCompute");

  return state;
}

/** The program's facts, computed once for all the program's modules. */
export function factsOf(ctx: Ctx): ProgramFacts {
  const state = stateOf(ctx);

  state.facts ??= programFacts(state.lp);
  return state.facts;
}

const TASK_CONTEXT = cpp.reference(cpp.type("lucent::TaskContext"));

/** How the task variant of a function is named: `edges` → `edges_task_`. */
const VARIANT = "_task_";

/** Where a task's safepoints find their TaskContext. */
export const TASK = "task_";

/** A safepoint, at the start of each loop iteration of a task variant. */
export function safepoint(): cpp.Stmt {
  return cpp.exprStmt(cpp.call(cpp.dot(cpp.id(TASK), "checkCancelled")));
}

/**
 * The task variant of the module function `g`, asked for from a task
 * variant's code: undefined for a function without one (generic, async or
 * a generator), which a task calls as it is.
 */
export function taskVariant(ctx: Ctx, g: FunctionGlobal): cpp.Expr | undefined {
  if (g.generic || g.async || g.decl.asteriskToken || !g.decl.body) return undefined;

  const variants = stateOf(ctx).variants;

  if (!variants.has(g.decl)) variants.set(g.decl, { g, emitted: false });

  return cpp.id(`${g.cpp}${VARIANT}`);
}

/**
 * Emits the task variants asked for, and those their code asks for in
 * turn, into their modules: declared in the module's header, defined in
 * its unit.
 */
export function emitTaskVariants(
  ctx: Ctx,
  decls: Map<LucentModule, cpp.Decl[]>,
  defs: Map<LucentModule, cpp.Decl[]>,
): void {
  const variants = stateOf(ctx).variants;

  for (let pending = [...variants.values()].filter((v) => !v.emitted); pending.length;) {
    for (const v of pending) {
      v.emitted = true;
      emitVariant(ctx, v.g, decls.get(v.g.module)!, defs.get(v.g.module)!);
    }

    pending = [...variants.values()].filter((v) => !v.emitted);
  }
}

function emitVariant(ctx: Ctx, g: FunctionGlobal, decls: cpp.Decl[], defs: cpp.Decl[]): void {
  const em = new FnEmitter(ctx, {
    module: g.module,
    async: false,
    returnType: g.type.ret,
    task: true,
  });
  const before = ctx.diagnostics.length;
  const warned = ctx.warnings.length;
  let params: cpp.Param[] = [];

  ctx.guard(() => {
    params = em.emitParams(g.decl, g.params);
    em.emitFunctionBody(g.decl);
  });

  // The function's own code reported what its variant repeats.
  const fresh = ctx.diagnostics.splice(before).filter((d) => !reported(ctx.diagnostics, d));
  const freshWarnings = ctx.warnings.splice(warned).filter((d) => !reported(ctx.warnings, d));

  ctx.diagnostics.push(...fresh);
  ctx.warnings.push(...freshWarnings);

  const name = `${cppIdent(g.decl.name!.text)}${VARIANT}`;
  const all = [...params, cpp.param(TASK_CONTEXT, TASK)];
  const ret = ctx.reg.cppRetType(g.type.ret);

  ctx.nativeUnit(g.module).include("lucent/compute.h");
  decls.push(cpp.fn(name, ret, all));
  defs.push(cpp.fn(name, ret, all, em.body(), { scope: cpp.type(g.module.ns) }));
}

function reported(list: Ctx["diagnostics"], d: Ctx["diagnostics"][number]): boolean {
  return list.some(
    (x) => x.code === d.code && x.message === d.message && x.file === d.file && x.line === d.line,
  );
}

/** A module header's declarations ahead of its own: TaskContext, for its task variants. */
export function taskHeader(ctx: Ctx, m: LucentModule): cpp.Decl[] {
  const has = [...stateOf(ctx).variants.values()].some((v) => v.g.module === m);

  return has
    ? [
        cpp.namespace("lucent", [
          { k: "struct", name: "TaskContext", members: [], class: true, forward: true },
        ]),
      ]
    : [];
}

const optionalSignal = unionOf([T.abortSignal, T.undefined]);

/**
 * What a call of compute evaluates, in order: its input, then the signal
 * of its options. The task and the options object are not values at run
 * time. Undefined for any other call.
 */
export function computeOperands(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
): ts.Expression[] | undefined {
  const found = checker.getSymbolAtLocation(node.expression);
  const sym = found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;

  if (!sym || sym.name !== "compute" || !isCoreSymbol(sym)) return undefined;

  const [, input, options] = node.arguments;
  const signal =
    options && ts.isObjectLiteralExpression(options) ? options.properties[0] : undefined;
  const value =
    signal && ts.isPropertyAssignment(signal)
      ? signal.initializer
      : signal && ts.isShorthandPropertyAssignment(signal)
        ? signal.name
        : undefined;

  return [input, value].filter((e): e is ts.Expression => !!e);
}

/** `compute(task, input, options?)`. */
export function computeCall(em: FnEmitter, node: ts.CallExpression): E {
  const [taskArg, inputArg, optionsArg] = node.arguments;

  if (!taskArg || !inputArg || node.arguments.length > 3)
    fail(
      node,
      Codes.UnsupportedCall,
      "compute takes a function, its input and, optionally, { signal }",
    );

  if (inGeneric(node))
    fail(
      node,
      Codes.UnsupportedCall,
      "compute cannot be called from generic code yet: call it from a function or class that is not generic",
    );

  const g = taskOf(em, taskArg);
  const param = g.params[0]!;
  const facts = factsOf(em.ctx);

  refuse(em, node, g, facts);

  const signal = signalOf(em, optionsArg);
  const inCpp = cpp.type("std::tuple", em.reg.cppType(param.cppType));
  const outCpp = em.reg.cppRetType(g.type.ret);

  transports(em, node, g, param.cppType);

  for (const buffer of movedByInput(em, inputArg))
    refuseLaterUse(em, buffer, node, "it moved to a compute task");

  const entry = taskEntry(em, g, inCpp, outCpp);
  const input = cpp.construct(inCpp, [em.exprAs(inputArg, param.cppType)], true);
  const options = cpp.construct(
    cpp.type("lucent::ComputeOptions"),
    [signal, cpp.call("lucent::moduleScope")],
    true,
  );

  return { c: cpp.call("lucent::compute", [entry, input, options]), t: em.lt(node) };
}

/**
 * Whether `node` is in a generic function or class, whose body is a C++
 * template in a header: it cannot name the unit's task entries.
 */
function inGeneric(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent)
    if ((ts.isFunctionLike(p) || ts.isClassLike(p)) && p.typeParameters?.length) return true;

  return false;
}

/** The task: a function declared at the top level of a module, of one plain parameter. */
function taskOf(em: FnEmitter, arg: ts.Expression): FunctionGlobal {
  const found = ts.isIdentifier(arg) ? em.checker.getSymbolAtLocation(arg) : undefined;
  const g = found ? em.ctx.globals.get(em.ctx.resolve(found)) : undefined;
  const hint = "pass its name: compute(work, input)";

  if (g?.kind !== "function")
    fail(
      arg,
      Codes.UnsupportedCall,
      `compute runs a function declared at the top level of a module; ${hint}`,
    );

  const one = g.params.length === 1 && !g.params[0]!.optional && !g.params[0]!.rest;

  if (g.generic || !one)
    fail(
      arg,
      Codes.UnsupportedCall,
      `compute runs a function declared at the top level of a module taking one parameter, not generic: ${g.decl.name!.text} is not`,
    );

  return g;
}

/** Refuses a task that cannot run on a worker, or whose input or result cannot cross. */
function refuse(em: FnEmitter, node: ts.Node, g: FunctionGlobal, facts: ProgramFacts): void {
  const name = g.decl.name!.text;
  const cannot = `\`${name}\` cannot run in a compute task`;

  if (g.async)
    fail(
      node,
      Codes.NotIsolated,
      `${cannot}: it is async, and a task runs to its end on its worker`,
    );

  if (g.decl.asteriskToken)
    fail(node, Codes.NotIsolated, `${cannot}: it is a generator, which runs where it is iterated`);

  // A stub (a platform function on the host) has no code here: its platforms' builds check it.
  if (g.decl.body) {
    const unit = facts.unit(g.decl);
    if (!unit) throw new Error(`${name} has no analysis unit`);

    const [violation] = [...facts.check(unit, "task"), ...facts.checkCaptures(unit, "task")];

    if (violation) fail(node, Codes.NotIsolated, violation.message);
  }

  const checker = em.checker;
  const signature = checker.getSignatureFromDeclaration(g.decl)!;
  const param = g.decl.parameters[0]!;
  const paramName = ts.isIdentifier(param.name) ? param.name.text : "input";
  const input = facts.transfer(checker.getTypeAtLocation(param), paramName);
  const result = facts.transfer(checker.getReturnTypeOfSignature(signature), "result");

  if (input)
    fail(
      node,
      Codes.NotTransferable,
      `the input of \`${name}\` cannot be copied to a compute task: \`${input.path}\` is ${input.reason}.`,
    );

  if (result) {
    const what = result.path === "result" ? "it" : `\`${result.path}\``;

    fail(
      node,
      Codes.NotTransferable,
      `the result of \`${name}\` cannot come back from a compute task: ${what} is ${result.reason}.`,
    );
  }
}

/** The options' signal, from an object literal: `{ signal }`, `{ signal: s }`, `{}`. */
function signalOf(em: FnEmitter, options: ts.Expression | undefined): cpp.Expr {
  const none = cpp.construct(em.reg.cppType(optionalSignal));

  if (!options) return none;

  const shape = "pass compute's options as an object literal: { signal }";

  if (!ts.isObjectLiteralExpression(options)) fail(options, Codes.UnsupportedCall, shape);

  const [signal, ...others] = options.properties;
  const named = (p: ts.ObjectLiteralElementLike) =>
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
    ts.isIdentifier(p.name) &&
    p.name.text === "signal";

  if (others.length || (signal && !named(signal))) fail(options, Codes.UnsupportedCall, shape);

  if (!signal) return none;

  const value = ts.isPropertyAssignment(signal)
    ? signal.initializer
    : (signal as ts.ShorthandPropertyAssignment).name;

  return em.exprAs(value, optionalSignal);
}

/**
 * The task entry of `g`, declared once in the calling module's unit: a
 * function taking the input tuple and the task's context, calling `g`'s
 * task variant.
 */
function taskEntry(em: FnEmitter, g: FunctionGlobal, inCpp: cpp.Type, outCpp: cpp.Type): cpp.Expr {
  const unit = em.ctx.nativeUnit(em.opts.module);
  const fn = cppIdent(g.decl.name!.text);

  // A stub (a platform function on the host) has no variant: it runs as it is.
  const variant = taskVariant(em.ctx, g);
  const argument = cpp.call("std::move", [cpp.call("std::get", [cpp.id("input")], [cpp.num(0)])]);
  const call = variant ? cpp.call(variant, [argument, cpp.id(TASK)]) : cpp.call(g.cpp, [argument]);

  const run = cpp.fn(
    `run_${fn}`,
    outCpp,
    [cpp.param(cpp.reference(inCpp, true), "input"), cpp.param(TASK_CONTEXT, TASK)],
    [cpp.ret(call)],
    { static: true },
  );
  const entryType = cpp.type("lucent::TaskEntry", inCpp, outCpp);
  const label = cpp.comma(
    cpp.str(`${g.module.name}.${g.decl.name!.text}`),
    cpp.addressOf(cpp.id(`run_${fn}`)),
  );
  const entry: cpp.Decl = {
    k: "var",
    stmt: cpp.varDecl(entryType, `entry_${fn}`, label, {
      style: "brace",
      static: true,
      constexpr: true,
    }) as cpp.Stmt & {
      k: "var";
    },
  };

  // Named by module, then function: no two tasks' names can meet.
  unit.include("lucent/compute.h");
  unit.add(`task ${g.cpp}`, [cpp.namespace(`${TASKS}::${g.module.ns}`, [run, entry])]);
  return cpp.id(`${TASKS}::${g.module.ns}::entry_${fn}`);
}

/** Where task entries live, in the units that compute. */
const TASKS = "lucent_tasks";

/**
 * Declares, in the calling module's unit, how each struct and class the
 * input holds is copied to a task; refuses a part the runtime cannot copy.
 * All declarations come before the definitions, so types that hold each
 * other can refer to each other's copies.
 */
function transports(em: FnEmitter, node: ts.Node, g: FunctionGlobal, input: LType): void {
  const objects = new Map<string, LType & { k: "struct" | "class" }>();
  const unit = em.ctx.nativeUnit(em.opts.module);
  const name = g.decl.name!.text;

  const visit = (t: LType, path: string): void => {
    const parts = PARTS[t.k];

    if (!parts)
      fail(
        node,
        Codes.NotTransferable,
        `the input of \`${name}\` cannot be copied to a compute task: \`${path}\` is a ${typeKey(t)}, which the compiler cannot copy yet.`,
      );

    if ((t.k === "struct" || t.k === "class") && !objects.has(typeKey(t))) {
      objects.set(typeKey(t), t);

      for (const f of fieldsOf(em, t)) visit(f.type, `${path}.${f.name}`);
      return;
    }

    for (const part of parts(t as never)) visit(part, path);
  };

  visit(input, g.decl.parameters[0]!.name.getText());

  const types = [...objects.values()];

  for (const t of types) unit.add(`transport ${typeKey(t)}`, [transportDecl(em, t)]);

  for (const t of types) unit.add(`transport code ${typeKey(t)}`, [transportDef(em, t)]);
}

/** The parts of each kind of value the runtime copies; kinds missing here cannot be copied. */
const PARTS: Partial<Record<LType["k"], (t: never) => LType[]>> = {
  number: () => [],
  boolean: () => [],
  string: () => [],
  undefined: () => [],
  null: () => [],
  void: () => [],
  bytes: () => [],
  date: () => [],
  buffer: () => [],
  opt: (t: LType & { k: "opt" }) => [t.inner],
  union: (t: LType & { k: "union" }) => t.ms,
  array: (t: LType & { k: "array" }) => [t.e],
  tuple: (t: LType & { k: "tuple" }) => t.es,
  map: (t: LType & { k: "map" }) => [t.key, t.val],
  set: (t: LType & { k: "set" }) => [t.e],
  dict: (t: LType & { k: "dict" }) => [t.val],
  struct: () => [],
  class: () => [],
};

/** The data fields of a struct, or of a class and its bases (which its copy must hold). */
function fieldsOf(
  em: FnEmitter,
  t: LType & { k: "struct" | "class" },
): { name: string; type: LType }[] {
  if (t.k === "struct")
    return em.reg.struct(t.id).fields.map((f) => ({ name: f.name, type: f.type }));

  const out = new Map<string, LType>();

  const own = em.reg.chain(t)[0]!.info;

  if (own.abstract) {
    const name = own.decl.name!.text;

    fail(
      own.decl,
      Codes.NotTransferable,
      `${name} objects cannot be copied to a compute task: ${name} is abstract, and a copy is made as the class its type names`,
    );
  }

  for (const { info, t: owner } of em.reg.chain(t)) {
    if (info.isError || info.sdkBase)
      fail(
        info.decl,
        Codes.NotTransferable,
        `${info.decl.name!.text} objects cannot be copied to a compute task`,
      );

    const ctor = info.decl.members.find(ts.isConstructorDeclaration);
    const fields = [
      ...parameterProperties(ctor),
      ...info.decl.members.filter(
        (m): m is ts.PropertyDeclaration =>
          ts.isPropertyDeclaration(m) &&
          !ts.getModifiers(m)?.some((k) => k.kind === ts.SyntaxKind.StaticKeyword),
      ),
    ];
    const map = argMap(em.ctx, owner);

    for (const f of fields) {
      const field = memberName(f);

      if (!out.has(field))
        out.set(field, substitute(em.reg.lower(em.checker.getTypeAtLocation(f), f), map));
    }
  }

  return [...out].map(([name, type]) => ({ name, type }));
}

function objectType(em: FnEmitter, t: LType & { k: "struct" | "class" }): cpp.Type {
  return t.k === "struct"
    ? cpp.type(`lucent_app::${em.reg.struct(t.id).cppName}`)
    : em.reg.cppClassType(t);
}

function transportType(em: FnEmitter, t: LType & { k: "struct" | "class" }): cpp.Type {
  return cpp.type("Transport", cpp.type("lucent::Ref", objectType(em, t)));
}

const GRAPH = cpp.reference(cpp.type("lucent::CopyGraph"));

/** `template <> struct Transport<Ref<S>> { static Ref<S> copy(const Ref<S>&, CopyGraph&); };` */
function transportDecl(em: FnEmitter, t: LType & { k: "struct" | "class" }): cpp.Decl {
  const ref = cpp.type("lucent::Ref", objectType(em, t));
  const copy = cpp.method(
    "copy",
    ref,
    [cpp.param(cpp.reference(cpp.constType(ref)), "source"), cpp.param(GRAPH, "graph")],
    undefined,
    {
      static: true,
    },
  );

  return cpp.namespace("lucent", [cpp.struct("Transport", [copy], { template: [], args: [ref] })]);
}

/** Its copy: the object once per graph, then each field, as transport.h copies them. */
function transportDef(em: FnEmitter, t: LType & { k: "struct" | "class" }): cpp.Decl {
  const object = objectType(em, t);
  const ref = cpp.type("lucent::Ref", object);
  const graph = cpp.id("graph");
  const copies = fieldsOf(em, t).map((f) => {
    const field = cppIdent(f.name);
    const from = cpp.dot(cpp.id("from"), field);

    return cpp.exprStmt(
      cpp.assign(cpp.dot(cpp.id("to"), field), cpp.call("lucent::transport", [from, graph])),
    );
  });
  const fields = cpp.lambda(
    [],
    [
      cpp.param(cpp.reference(cpp.constType(object)), "from"),
      cpp.param(cpp.reference(object), "to"),
      cpp.param(GRAPH, "graph"),
    ],
    copies,
  );
  const body = [cpp.ret(cpp.call("lucent::transportObject", [cpp.id("source"), graph, fields]))];

  return cpp.namespace("lucent", [
    cpp.fn(
      "copy",
      ref,
      [cpp.param(cpp.reference(cpp.constType(ref)), "source"), cpp.param(GRAPH, "graph")],
      body,
      {
        scope: transportType(em, t),
        inline: true,
      },
    ),
  ]);
}
