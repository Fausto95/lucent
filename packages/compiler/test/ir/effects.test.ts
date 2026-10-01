import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { programFacts } from "../../src/analysis/index.ts";
import { compile } from "../../src/index.ts";
import type { IrFunction } from "../../src/ir/ir.ts";
import { lower, type LowerHost } from "../../src/ir/lower.ts";
import { verify } from "../../src/ir/verify.ts";
import { createLucentProgram } from "../../src/program.ts";
import { type LType, TypeRegistry } from "../../src/types.ts";

const SOURCE = `let count = 0;
const limit = 3;
function inc(x: number): number {
  return x + limit;
}
function bump(): number {
  count++;
  return count;
}
function fail(): number {
  throw new Error("no");
}
export function run(x: number): number {
  return inc(x) + bump();
}
export function risky(): number {
  return fail();
}
`;

function file(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ir-effects-"));
  const f = path.join(dir, "m.lucent.ts");

  fs.writeFileSync(f, SOURCE);
  return f;
}

/** Lowers function `name` with the analysis's effects, as the emitter does; `analysed: false` without them. */
function lowered(
  name: string,
  analysed = true,
): { fn: IrFunction; facts: ReturnType<typeof programFacts> } {
  const lp = createLucentProgram([file()]);
  const facts = programFacts(lp);
  const sf = lp.modules[0]!.sourceFile;
  const checker = lp.checker;
  const reg = new TypeRegistry(checker, (s) => s === sf);
  const signature = (d: ts.FunctionDeclaration) =>
    reg.lowerSignature(checker.getSignatureFromDeclaration(d)!, d) as LType & { k: "fn" };
  const effects = (d: ts.Node) => {
    const u = facts.unit(d);

    return analysed && u ? { effects: facts.effects(u) } : {};
  };
  const host: LowerHost = {
    checker,
    typeAt: (n) => reg.lower(checker.getTypeAtLocation(n), n),
    typeOf: (s, at) => reg.lower(checker.getTypeOfSymbolAtLocation(s, at), at),
    global: (s) => {
      const d = s.valueDeclaration;

      if (d && ts.isFunctionDeclaration(d)) {
        const t = signature(d);

        return {
          kind: "function",
          id: d.name!.text,
          params: t.params,
          result: t.ret,
          callable: true,
          ...effects(d),
        };
      }

      if (d && ts.isVariableDeclaration(d))
        return {
          kind: "var",
          id: `m::${d.name.getText()}`,
          name: d.name.getText(),
          type: reg.lower(checker.getTypeOfSymbolAtLocation(s, d), d),
          mutable: !(d.parent.flags & ts.NodeFlags.Const),
        };

      return undefined;
    },
  };
  const decl = sf.statements.filter(ts.isFunctionDeclaration).find((d) => d.name!.text === name)!;
  const t = signature(decl);
  const input = { decl, id: name, params: t.params, result: t.ret, async: false, generic: false };

  return { fn: lower({ ...input, ...effects(decl) }, host).fn, facts };
}

const calls = (fn: IrFunction) =>
  fn.regions.flatMap((r) =>
    r.ops.flatMap((op) =>
      op.kind === "call" && op.callee.kind === "function"
        ? [[op.callee.id, op.effects.throws]]
        : [],
    ),
  );

describe("IR effect records from the analysis", () => {
  it("takes a function's summary and its calls' throws from the callees' summaries", () => {
    const { fn, facts } = lowered("run");

    expect(fn.effects).toEqual(facts.effects(facts.byId("m.run")!));
    expect(fn.effects).toMatchObject({ reads: "module", writes: "module", throws: "no" });
    expect(calls(fn)).toEqual([
      ["inc", "no"],
      ["bump", "no"],
    ]);
    expect(calls(lowered("risky").fn)).toEqual([["fail", "yes"]]);
    expect(() => verify(fn)).not.toThrow();
  });

  it("does not count a const module number as state", () => {
    const analysed = lowered("inc").fn;
    const own = lowered("inc", false).fn;

    expect(analysed.effects.reads).toBe("none");
    expect(own.effects).toMatchObject({ reads: "none", throws: "no", callbacks: "none" });
    expect(() => verify(analysed)).not.toThrow();
  });

  it("still refuses a summary that hides a mutable module variable's load", () => {
    const { fn } = lowered("bump");

    expect(() => verify({ ...fn, effects: { ...fn.effects, reads: "none" } })).toThrow(
      /reads no state, but it loads a module variable/,
    );
  });

  it("refuses a summary claiming less state than a callee's", () => {
    const { fn, facts } = lowered("run");
    const bump = facts.effects(facts.byId("m.bump")!);
    const env = { effects: (id: string) => (id === "bump" ? bump : undefined) };

    expect(() =>
      verify({ ...fn, effects: { ...fn.effects, reads: "none", writes: "none" } }, env),
    ).toThrow(/reads less state than bump does/);
  });

  it("compiles through the IR with the analysis's claims", () => {
    expect(compile([file()]).diagnostics).toEqual([]);
  });
});
