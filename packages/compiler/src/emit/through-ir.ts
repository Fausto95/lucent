/**
 * The emitter's one hook into the semantic IR (ir/): a function, method,
 * accessor, constructor, module `init()` or task variant lowered through
 * it. The host it lowers with gives the program's types, declarations
 * and platform, and plans leaves with the emitter's code.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import type { ProgramFacts } from "../analysis/index.ts";
import type { FunctionLike } from "../analysis/scopes.ts";
import { type CppFunction, lowerToCpp } from "../ir/cpp.ts";
import type {
  Ambient,
  Initialization,
  Initializer,
  LowerHost,
  NestedSignature,
} from "../ir/lower.ts";
import type { LucentModule } from "../program.ts";
import { branchPlatform, platformGuard, switchPlatforms } from "../platforms.ts";
import type { LType } from "../types.ts";
import type { Ctx, ParamInfo } from "./context.ts";
import { type FnOptions, FnEmitter, usesThisIn } from "./function.ts";
import { functionName, isMathGlobal } from "./builtins.ts";
import { inferIntegers } from "./integers.ts";
import { stackObjects } from "./stack-objects.ts";
import { leafHost } from "./leaf.ts";
import { CONTENT, setupOf } from "./setups.ts";
import { liftedStatement } from "./toolkit.ts";
import { helperStatement } from "../ui/view-helpers.ts";

/** What lowering through the IR needs of the program: the facts its effect records come from. */
export interface IrMode {
  facts: ProgramFacts;
}

/** A body to lower: a function's, a method's or an accessor's. */
export interface IrUnit {
  decl: FunctionLike;
  /** Its name in dumps and coverage. */
  id: string;
  params: ParamInfo[];
  /** What it returns: for an async function, what its promise fulfils with. */
  result: LType;
  async: boolean;
  /** Of a generator, what it gives its caller each time. */
  generator?: LType;
  generic: boolean;
  /** How the emitter's leaves see the code (its class, how `this` is spelled). */
  opts: FnOptions;
  /** The name the Errors it creates record as their site. */
  site: string;
  /** Statements its C++ body starts with. */
  prologue?: cpp.Stmt[];
  /** A constructor's: what it initializes, and whether `super(…)` comes first. */
  construct?: { initializers: Initializer[]; base: boolean };
  /** What its code spans, when more than its declaration (a class's field initializers). */
  span?: ts.Node;
  /** A compute task's variant: its loops check for cancellation, its calls call variants. */
  task?: boolean;
  /** What its code may read that the caller declares around it (a setup's mount). */
  ambient?: Ambient[];
}

/** `unit` lowered through the IR (what it does not support is a LUCENT diagnostic). */
export function throughIr(ctx: Ctx, unit: IrUnit, ir: IrMode): CppFunction {
  const known = ir.facts.unit(unit.decl);
  const input = {
    decl: unit.decl,
    id: unit.id,
    params: unit.params.map((p) => p.cppType),
    defaulted: unit.decl.parameters.map((p, i) =>
      p.initializer ? unit.params[i]!.type : undefined,
    ),
    result: unit.result,
    ...(unit.generator ? { generator: unit.generator } : {}),
    async: unit.async,
    generic: unit.generic,
    ...(known ? { effects: ir.facts.effects(known) } : {}),
    ...(unit.construct ? { construct: unit.construct } : {}),
    ...(unit.span ? { span: unit.span } : {}),
    ...(unit.task ? { task: true } : {}),
    ...(unit.ambient ? { ambient: unit.ambient } : {}),
  };
  const backend = {
    cppType: (t: LType) => ctx.reg.cppType(t),
    cppRetType: (t: LType) => ctx.reg.cppRetType(t),
    objectType: (t: LType) => objectType(ctx, t),
    site: unit.site,
    ...(unit.prologue ? { prologue: unit.prologue } : {}),
  };

  return lowerToCpp(input, irHost(ctx, ir.facts, unit.opts), backend);
}

/** A module's `init()` through the IR: its classes' static fields, then its variables, in order. */
export function initThroughIr(
  ctx: Ctx,
  module: LucentModule,
  initializers: Initializer[],
  ir: IrMode,
): CppFunction {
  // The analysis does not count a module's initializing its own variables as writing state: the
  // IR's record is its own.
  const init = {
    id: `${module.ns}::init`,
    source: module.sourceFile,
    initializers,
    // A platform module's constants are its declaration file's.
    ...(module.declaration ? { elsewhere: [module.declaration] } : {}),
  };
  const opts = { module, async: false };

  return initializationThroughIr(ctx, init, opts, "<module>", ir);
}

/** Code that only initializes (an `init()`, an implicit constructor) through the IR. */
export function initializationThroughIr(
  ctx: Ctx,
  init: Initialization,
  opts: FnOptions,
  site: string,
  ir: IrMode,
): CppFunction {
  const backend = {
    cppType: (t: LType) => ctx.reg.cppType(t),
    cppRetType: (t: LType) => ctx.reg.cppRetType(t),
    objectType: (t: LType) => objectType(ctx, t),
    site,
  };

  return lowerToCpp(init, irHost(ctx, ir.facts, opts), backend);
}

/** The C++ type of an object of the object type `t` itself, on the stack (stack-objects.ts). */
function objectType(ctx: Ctx, t: LType): cpp.Type {
  if (t.k !== "struct") throw new Error(`internal: a ${t.k} on the stack`);

  return cpp.type(`lucent_app::${ctx.reg.struct(t.id).cppName}`);
}

/** The host a body with the emitter's options `opts` lowers with. */
function irHost(ctx: Ctx, facts: ProgramFacts, opts: FnOptions): LowerHost {
  const effects = (decl: ts.Node) => {
    const unit = facts.unit(decl);

    return unit ? { effects: facts.effects(unit) } : {};
  };

  return {
    checker: ctx.checker,
    typeAt: (node) => ctx.lowerAt(node),
    typeOf: (sym, at) => ctx.reg.lower(ctx.checker.getTypeOfSymbolAtLocation(sym, at), at),
    global: (sym) => {
      const resolved = ctx.resolve(sym);
      const d = ctx.failed.has(resolved) ? undefined : ctx.globals.get(resolved);

      if (d?.kind === "function")
        return {
          kind: "function" as const,
          id: d.cpp,
          params: d.params.map((p) => p.cppType),
          result: d.type.ret,
          callable: !d.generic && !d.async && d.params.every((p) => !p.optional && !p.rest),
          ...effects(d.decl),
        };

      if (d?.kind === "var")
        return {
          kind: "var" as const,
          id: d.cpp,
          name: d.decl.name.getText(),
          type: d.type,
          mutable: !d.isConst,
          ...(d.literal ? { literal: d.literal } : {}),
        };

      return undefined;
    },
    platformGuard: (cond) => {
      const guard = platformGuard(ctx.checker, cond);

      if (!guard) return undefined;

      const runs = !ctx.platform
        ? "nowhere"
        : guard.platform === ctx.platform
          ? "here"
          : "elsewhere";

      return { runs, rest: guard.rest } as const;
    },
    platformClauses: (s) => {
      const runs = switchPlatforms(ctx.checker, s);
      const target = ctx.platform;

      if (!runs) return undefined;

      return target ? runs.map((r) => r.includes(target)) : ("nowhere" as const);
    },
    // Neither another platform's code nor a toolkit's own (its body's statements, a helper view).
    runsHere: (s) => {
      const p = branchPlatform(ctx.checker, s);

      if (p !== undefined && p !== ctx.platform) return false;

      return !liftedStatement(ctx, s) && !helperStatement(ctx.checker, s);
    },
    isBoxed: (sym) => ctx.capture.isBoxed(sym),
    isError: (t) => t.k === "class" && ctx.reg.cls(t.id).isError,
    derives: (sub, base) =>
      sub.k === "class" && base.k === "class" && ctx.reg.derives(sub.id, base.id),
    effectsOf: (node) => effects(node).effects,
    signatureOf: (node, target) => {
      const sig = new FnEmitter(ctx, opts).closureSignature(node, target);
      // A callback takes the parameters of the type it becomes, even those it leaves out.
      const extra = sig.fnType.params.slice(node.parameters.length);

      return {
        type: sig.fnType,
        params: [...sig.params.map((p) => p.cppType), ...extra],
        defaulted: node.parameters.map((p, i) => (p.initializer ? sig.params[i]!.type : undefined)),
        async: sig.isAsync,
        generator: sig.isGen,
      };
    },
    // A closure in a method spells `this` as `self`, the reference it captures.
    self: (node) => {
      if (!opts.thisExpr || !usesThisIn(node)) return undefined;

      const em = new FnEmitter(ctx, opts);
      const type: LType = { k: "class", id: opts.cls!.id, args: [] };

      return { name: "this", code: em.selfRefExpr(), type };
    },
    nested: (_node, sig: NestedSignature) =>
      irHost(ctx, facts, {
        ...opts,
        async: sig.async,
        ...(opts.thisExpr ? { thisExpr: "self" } : {}),
        ...(opts.thisRef || opts.thisExpr ? { thisRef: "self" } : {}),
        task: false,
      }),
    siteOf: (node) => functionName(node.body ?? node),
    enters: (node) => (setupOf(ctx, node) ? CONTENT : undefined),
    markFailed: (name) => ctx.markFailed(name),
    integers: (fn) => {
      if (!fn.body) return new Map();

      const em = new FnEmitter(ctx, opts);
      const isBoxed = (sym: ts.Symbol) => ctx.capture.isBoxed(sym);
      const lowered = (d: ts.VariableDeclaration, sym: ts.Symbol) => {
        try {
          return ctx.reg.lower(ctx.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name);
        } catch {
          return undefined;
        }
      };
      const number = (d: ts.VariableDeclaration, sym: ts.Symbol) => lowered(d, sym)?.k === "number";
      const numbers = (d: ts.VariableDeclaration, sym: ts.Symbol) => {
        const t = lowered(d, sym);

        return t?.k === "array" && t.e.k === "number";
      };
      const runs = (d: ts.Node) => {
        const p = branchPlatform(ctx.checker, d);

        return p === undefined || p === ctx.platform;
      };
      const facts = inferIntegers(fn.body, {
        checker: ctx.checker,
        // Locals of code this target never runs are not lowered: their types stay out of its output.
        candidate: (d, sym) => runs(d) && !isBoxed(sym) && number(d, sym),
        arrayCandidate: (d, sym) => runs(d) && !isBoxed(sym) && numbers(d, sym),
        isBoxed,
        isMath: (id) => isMathGlobal(em, id),
      });

      // A `for` counter is an int64: exact for every value JavaScript can count to. An array of
      // numbers in the map holds integer elements of the kind.
      return new Map([
        ...facts.locals,
        ...[...facts.counters].map((c) => [c, "i64" as const] as const),
        ...facts.arrays,
      ]);
    },
    objects: (fn) => {
      if (!fn.body) return new Set();

      return stackObjects(fn.body, {
        checker: ctx.checker,
        candidate: (d, sym) => {
          const platform = branchPlatform(ctx.checker, d);

          if (ctx.capture.isBoxed(sym) || (platform !== undefined && platform !== ctx.platform))
            return false;

          try {
            return (
              ctx.reg.lower(ctx.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name).k ===
              "struct"
            );
          } catch {
            return false;
          }
        },
        escapes: (sym) => facts.escapes(sym).length > 0,
      });
    },
    leaves: leafHost(ctx, opts),
  };
}
