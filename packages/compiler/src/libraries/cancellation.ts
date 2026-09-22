import type { LibraryModule } from "../libraries.ts";
import { nativeSource } from "../native-sources.generated.ts";
import { nativeSymbolId } from "../native-contracts.ts";
const symbol = (name: string, abi: string) => nativeSymbolId("Lucent", "CancellationSource", name, abi);
export const CANCELLATION_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type CancellationSource = {cancelled:boolean};
export declare function CancellationSource__create():CancellationSource;
export declare function CancellationSource__get_cancelled(lucentSelf:CancellationSource):boolean;
export declare function CancellationSource__method_cancel(lucentSelf:CancellationSource):void;
export declare function CancellationSource__method_throwIfCancelled(lucentSelf:CancellationSource):void;
export declare function CancellationSource__method_scope(lucentSelf:CancellationSource):CancellationSource;
export declare function CancellationSource__method_finish(lucentSelf:CancellationSource):boolean;`,
  references: {
    CancellationSource: {
      swift: "LucentCancellationSource",
      kotlin: "LucentCancellationSource",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
  },
  bindings: {
    CancellationSource__create: {
      contract: { symbolId: symbol("init", "()->CancellationSource"), result: "owned" },
      swift: ["return LucentCancellationSource()"],
      kotlin: ["return LucentCancellationSource()"],
    },
    CancellationSource__get_cancelled: {
      contract: { symbolId: symbol("cancelled", "()->Bool") },
      swift: ["return lucentSelf.cancelled"],
      kotlin: ["return lucentSelf.cancelled"],
    },
    CancellationSource__method_cancel: {
      contract: { symbolId: symbol("cancel", "()->Void") },
      swift: ["lucentSelf.cancel()"],
      kotlin: ["lucentSelf.cancel()"],
    },
    CancellationSource__method_throwIfCancelled: {
      contract: { symbolId: symbol("throwIfCancelled", "()->Void throws") },
      swift: ["try lucentSelf.throwIfCancelled()"],
      kotlin: ["lucentSelf.throwIfCancelled()"],
    },
    CancellationSource__method_scope: {
      contract: { symbolId: symbol("scope", "()->CancellationSource"), result: "owned" },
      swift: ["return lucentSelf.scope()"],
      kotlin: ["return lucentSelf.scope()"],
    },
    CancellationSource__method_finish: {
      contract: { symbolId: symbol("finish", "()->Bool") },
      swift: ["return lucentSelf.finish()"],
      kotlin: ["return lucentSelf.finish()"],
    },
  },
  native: {
    swift: { "Cancellation.swift": nativeSource("Cancellation.swift") },
    kotlin: { "Cancellation.kt": nativeSource("Cancellation.kt") },
  },
};
