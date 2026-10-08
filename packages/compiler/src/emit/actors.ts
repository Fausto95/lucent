/**
 * Module actors: the modules that share objects run on one actor, with a
 * lock and a thread of their own (lucent/scheduler.h). Modules share
 * objects only through imports (a class instance, a closure, a promise),
 * so an actor is an import component: modules that import one another,
 * type-only imports included (a value of an imported type can reach the
 * module through JavaScript). A package's modules and the app's own, or two
 * packages that do not import each other, run on different actors, so a
 * long job in one delays neither the other nor the main thread.
 */
import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import type { LucentModule } from "../program.ts";

export interface Actors {
  /** Each module's actor: an index into `names`. */
  readonly of: ReadonlyMap<LucentModule, number>;
  /** Each actor's name (its first module's, and how many more it has). */
  readonly names: readonly string[];
}

/** The program's actors: one per import component, in the modules' order. */
export function actorsOf(
  checker: ts.TypeChecker,
  modules: readonly LucentModule[],
  byFile: ReadonlyMap<string, LucentModule>,
): Actors {
  const parent = new Map<LucentModule, LucentModule>(modules.map((m) => [m, m]));
  const root = (m: LucentModule): LucentModule => {
    let r = m;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(m, r);
    return r;
  };

  for (const m of modules)
    for (const s of m.sourceFile.statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;

      const sym = checker.getSymbolAtLocation(s.moduleSpecifier);
      const target = sym?.valueDeclaration ?? sym?.declarations?.[0];
      const file = target && ts.isSourceFile(target) ? path.resolve(target.fileName) : undefined;
      const dep = file ? byFile.get(file) : undefined;

      if (dep && dep !== m) parent.set(root(dep), root(m));
    }

  const index = new Map<LucentModule, number>();
  const members: LucentModule[][] = [];
  const of = new Map<LucentModule, number>();

  for (const m of modules) {
    const r = root(m);
    let i = index.get(r);
    if (i === undefined) {
      i = members.length;
      index.set(r, i);
      members.push([]);
    }

    members[i]!.push(m);
    of.set(m, i);
  }

  const names = members.map((ms) =>
    ms.length > 1 ? `${ms[0]!.name}+${ms.length - 1}` : ms[0]!.name,
  );

  return { of, names };
}

/** The C++ name of actor `i`'s accessor (lucent_app.h). */
export function actorName(i: number): string {
  return `lucent_app::actor_${i}`;
}

/** `lucent_app::actor_N()`: the actor of module code. */
export function actorCall(i: number): cpp.Expr {
  return cpp.call(actorName(i), []);
}

/**
 * The accessors, in lucent_app.h: each makes its actor on first use (a
 * function-local static, made once whichever thread asks first).
 */
export function actorDecls(actors: Actors): cpp.Decl[] {
  return actors.names.map((name, i) =>
    cpp.fn(
      `actor_${i}`,
      cpp.reference(cpp.type("lucent::Actor")),
      [],
      [
        cpp.varDecl(
          cpp.reference(cpp.type("lucent::Actor")),
          "a",
          cpp.call("lucent::Actor::create", [cpp.str(name)]),
          {
            static: true,
          },
        ),
        cpp.ret(cpp.id("a")),
      ],
      { inline: true },
    ),
  );
}
