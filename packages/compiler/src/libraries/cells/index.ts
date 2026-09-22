import type { LibraryModule, NativeBinding } from "../../libraries.ts";
import { nativeSymbolId } from "../../native-contracts.ts";
import { nativeSource } from "../../native-sources.generated.ts";

const operations = {
  Cell__create: ["return LucentCell(initial)", "return LucentCell(initial)"],
  Cell__get_value: ["return lucentSelf.value", "return lucentSelf.value"],
  Cell__set_value: ["lucentSelf.value = value", "lucentSelf.value = value"],
} as const;

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: nativeSymbolId("Lucent", "Cell", name, "v1"),
        ...(name === "Cell__create" ? { result: "owned" as const } : {}),
      },
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

export const CELLS_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type Cell={value:number};
export declare function Cell__create(initial:number):Cell;
export declare function Cell__get_value(lucentSelf:Cell):number;
export declare function Cell__set_value(lucentSelf:Cell,value:number):void;`,
  references: {
    Cell: {
      swift: "LucentCell",
      kotlin: "LucentCell",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
  },
  bindings,
  native: {
    swift: { "Cells.swift": nativeSource("Cells.swift") },
    kotlin: { "Cells.kt": nativeSource("Cells.kt") },
  },
};
