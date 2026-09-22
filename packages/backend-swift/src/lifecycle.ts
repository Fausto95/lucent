import { block, type Doc } from "@lucent-lang/codegen";
import type { IREffectSlot, IRFunction, IRResourceSlot, IRStmt } from "@lucent-lang/compiler";
import { printStmts, type SwiftStmt } from "./ast.ts";

/** Wrap a returned SwiftUI view with effect appear/disappear hooks. */
export function swiftViewLifecycle(fn: IRFunction, viewExpr: string, emitBlock: (stmts: IRStmt[]) => SwiftStmt[]): Doc {
  const effects = fn.effectSlots ?? [];
  const resources = fn.resources ?? [];
  if (!effects.length && !resources.length) return `return ${viewExpr}`;
  const syncEffects = effects.filter((slot) => !slot.async);
  const disappear = [
    ...syncEffects.flatMap((slot) => printStmts(emitBlock(slot.cleanup))),
    ...resourceCloses(resources),
  ];
  return block(
    "return AnyView(",
    [
      viewExpr,
      ...effects.flatMap((slot) => effectModifiers(slot, emitBlock)),
      ...(disappear.length ? [block(".onDisappear {", disappear)] : []),
    ],
    ")",
  );
}

function effectModifiers(slot: IREffectSlot, emitBlock: (stmts: IRStmt[]) => SwiftStmt[]): Doc[] {
  if (slot.async) {
    const setup = printStmts(emitBlock(slot.body));
    const cleanup = printStmts(emitBlock(slot.cleanup));
    return [
      block(".task {", [
        block(
          "await LucentEffectRunner.run(",
          [block("setup: {", setup, "},"), block("cleanup: {", cleanup, "}")],
          ")",
        ),
      ]),
    ];
  }
  return [block(".onAppear {", printStmts(emitBlock(slot.body)))];
}

function resourceCloses(resources: IRResourceSlot[]): Doc[] {
  return resources.map((slot) => `Task { try? await lucentGet_${slot.name}().${slot.close}() }`);
}
