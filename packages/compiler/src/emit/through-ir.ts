/**
 * The emitter's one hook into the semantic IR (ir/): a function, method or
 * accessor lowered through it, when LUCENT_LOWERING selects it and the IR
 * supports the code; the host it lowers with gives the program's types,
 * declarations and platform, and plans leaves with the emitter's code.
 */
import type { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import type { ProgramFacts } from "../analysis/index.ts";
import type { FunctionLike } from "../analysis/scopes.ts";
import { type CppFunction, type Lowering, lowerToCpp } from "../ir/cpp.ts";
import type { LowerHost, NestedSignature } from "../ir/lower.ts";
import { branchPlatform, platformGuard, switchPlatforms } from "../platforms.ts";
import { type LType, T } from "../types.ts";
import type { Ctx, ParamInfo } from "./context.ts";
import { type FnOptions, FnEmitter, usesThisIn } from "./function.ts";
import { functionName } from "./builtins.ts";
import { leafHost } from "./leaf.ts";

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
}

/** `unit` lowered through the IR, or undefined when it falls back to the legacy emitter (`ir`). */
export function throughIr(
  ctx: Ctx,
  unit: IrUnit,
  lowering: Exclude<Lowering, "legacy">,
  facts: ProgramFacts,
): CppFunction | undefined {
  const known = facts.unit(unit.decl);
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
    ...(known ? { effects: facts.effects(known) } : {}),
  };
  const backend = {
    cppType: (t: LType) => ctx.reg.cppType(t),
    cppRetType: (t: LType) => ctx.reg.cppRetType(t),
    site: unit.site,
    ...(unit.prologue ? { prologue: unit.prologue } : {}),
  };
  // What planning a leaf reported is the legacy emitter's to report again, when it lowers the code.
  const reported = { warnings: ctx.warnings.length, diagnostics: ctx.diagnostics.length };
  const lowered = lowerToCpp(lowering, input, irHost(ctx, facts, unit.opts), backend);

  if (!lowered) {
    ctx.warnings.length = reported.warnings;
    ctx.diagnostics.length = reported.diagnostics;
  }

  return lowered;
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
    runsHere: (s) => {
      const p = branchPlatform(ctx.checker, s);

      return p === undefined || p === ctx.platform;
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
        generator: sig.generator,
        returnType:
          sig.async && sig.type.ret.k === "promise"
            ? sig.type.ret.inner
            : sig.generator
              ? T.void
              : sig.type.ret,
        ...(opts.thisExpr ? { thisExpr: "self" } : {}),
        ...(opts.thisRef || opts.thisExpr ? { thisRef: "self" } : {}),
        isConstructor: false,
        task: false,
      }),
    siteOf: (node) => functionName(node.body ?? node),
    leaves: leafHost(ctx, opts),
  };
}
