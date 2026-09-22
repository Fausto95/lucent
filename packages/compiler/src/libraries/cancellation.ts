import type { LibraryModule } from "../libraries.ts";
import { nativeSymbolId } from "../native-contracts.ts";
const symbol = (name: string, abi: string) => nativeSymbolId("Lucent", "CancellationSource", name, abi);
export const CANCELLATION_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type CancellationSource = {cancelled:boolean};
export declare function CancellationSource__create():CancellationSource;
export declare function CancellationSource__get_cancelled(lucentSelf:CancellationSource):boolean;
export declare function CancellationSource__method_cancel(lucentSelf:CancellationSource):void;
export declare function CancellationSource__method_throwIfCancelled(lucentSelf:CancellationSource):void;`,
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
  },
  native: {
    swift: {
      "Cancellation.swift": `import Foundation
// Every access to the cancellation bit is synchronized; no SDK objects are transferred.
final class LucentCancellationSource: @unchecked Sendable {
  private let lock = NSLock()
  private var requested = false
  var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return requested }
  func cancel() { lock.lock(); requested = true; lock.unlock() }
  func throwIfCancelled() throws {
    if cancelled { throw LucentError(code: "CANCELLED", message: "Native operation was cancelled") }
  }
}
`,
    },
    kotlin: {
      "Cancellation.kt": `package {{androidPackage}}
class LucentCancellationSource {
  private val requested = java.util.concurrent.atomic.AtomicBoolean(false)
  val cancelled: Boolean get() = requested.get()
  fun cancel() { requested.set(true) }
  fun throwIfCancelled() {
    if (cancelled) throw LucentError("CANCELLED", "Native operation was cancelled")
  }
}
`,
    },
  },
};
