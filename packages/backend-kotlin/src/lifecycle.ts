import { block, sections, type Doc } from "@lucent-lang/codegen";
import type { IREffectSlot, IRFunction, IRResourceSlot, IRStmt } from "@lucent-lang/compiler";
import { printStmts, type KotlinStmt } from "./ast.ts";

/** Emit DisposableEffect / LaunchedEffect hooks before the Compose content expression. */
export function kotlinViewLifecycle(fn: IRFunction, content: Doc, emitBlock: (stmts: IRStmt[]) => KotlinStmt[]): Doc {
  const effects = fn.effectSlots ?? [];
  const resources = fn.resources ?? [];
  if (!effects.length && !resources.length) return content;
  const asyncEffects = effects.filter((slot) => slot.async);
  const syncEffects = effects.filter((slot) => !slot.async);
  return sections([
    ...asyncEffects.map((slot) => asyncEffect(slot, emitBlock)),
    ...(syncEffects.length || resources.length ? [disposableEffect(syncEffects, resources, emitBlock)] : []),
    content,
  ]);
}

function asyncEffect(slot: IREffectSlot, emitBlock: (stmts: IRStmt[]) => KotlinStmt[]): Doc {
  const setup = printStmts(emitBlock(slot.body));
  const cleanup = printStmts(emitBlock(slot.cleanup));
  return block("LaunchedEffect(Unit) {", [
    block("LucentEffectRunner.run(", [block("setup = {", setup, "},"), block("cleanup = {", cleanup, "}")], ")"),
  ]);
}

function disposableEffect(
  effects: IREffectSlot[],
  resources: IRResourceSlot[],
  emitBlock: (stmts: IRStmt[]) => KotlinStmt[],
): Doc {
  const setup = effects.flatMap((slot) => printStmts(emitBlock(slot.body)));
  const cleanup = [
    ...effects.flatMap((slot) => printStmts(emitBlock(slot.cleanup))),
    ...resources.map((slot) => `kotlinx.coroutines.runBlocking { lucentGet_${slot.name}().${slot.close}() }`),
  ];
  return block("DisposableEffect(Unit) {", [setup, block("onDispose {", cleanup)]);
}
