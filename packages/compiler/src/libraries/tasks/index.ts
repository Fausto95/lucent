import type { LibraryModule, NativeBinding } from "../../libraries.ts";
import { nativeSymbolId } from "../../native-contracts.ts";
import { nativeSource } from "../../native-sources.generated.ts";
const operations = {
  TaskScope__create: ["return LucentTaskScope()", "return LucentTaskScope()"],
  TaskScope__get_closing: ["return lucentSelf.closing", "return lucentSelf.closing"],
  TaskScope__get_activeCount: ["return lucentSelf.activeCount", "return lucentSelf.activeCount"],
  TaskScope__method_begin: ["return try lucentSelf.begin()", "return lucentSelf.begin()"],
  TaskScope__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  NativeTask__create: ["return try scope.begin()", "return scope.begin()"],
  NativeTask__get_cancelled: ["return lucentSelf.cancelled", "return lucentSelf.cancelled"],
  NativeTask__get_finished: ["return lucentSelf.finished", "return lucentSelf.finished"],
  NativeTask__method_cancel: ["lucentSelf.cancel()", "lucentSelf.cancel()"],
  NativeTask__method_finish: ["return lucentSelf.finish()", "return lucentSelf.finish()"],
  NativeTask__method_throwIfCancelled: ["try lucentSelf.throwIfCancelled()", "lucentSelf.throwIfCancelled()"],
} as const;
const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: nativeSymbolId("Lucent", "TaskScope", name, "v1"),
        ...(["TaskScope__create", "TaskScope__method_begin", "NativeTask__create"].includes(name)
          ? { result: "owned" as const }
          : {}),
      },
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);
export const TASKS_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type TaskScope={closing:boolean;activeCount:number};
export type NativeTask={cancelled:boolean;finished:boolean};
export declare function TaskScope__create():TaskScope;
export declare function TaskScope__get_closing(lucentSelf:TaskScope):boolean;
export declare function TaskScope__get_activeCount(lucentSelf:TaskScope):number;
export declare function TaskScope__method_begin(lucentSelf:TaskScope):NativeTask;
export declare function TaskScope__method_close(lucentSelf:TaskScope):Promise<void>;
export declare function NativeTask__create(scope:TaskScope):NativeTask;
export declare function NativeTask__get_cancelled(lucentSelf:NativeTask):boolean;
export declare function NativeTask__get_finished(lucentSelf:NativeTask):boolean;
export declare function NativeTask__method_cancel(lucentSelf:NativeTask):void;
export declare function NativeTask__method_finish(lucentSelf:NativeTask):boolean;
export declare function NativeTask__method_throwIfCancelled(lucentSelf:NativeTask):void;`,
  references: {
    TaskScope: {
      swift: "LucentTaskScope",
      kotlin: "LucentTaskScope",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    NativeTask: {
      swift: "LucentTask",
      kotlin: "LucentTask",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
  },
  bindings,
  native: {
    swift: { "Tasks.swift": nativeSource("Tasks.swift") },
    kotlin: { "Tasks.kt": nativeSource("Tasks.kt") },
  },
};
