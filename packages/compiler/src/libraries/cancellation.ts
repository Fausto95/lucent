import type { LibraryModule } from "../libraries.ts";
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
    swift: {
      "Cancellation.swift": `import Foundation
// Every access to the cancellation bit is synchronized; no SDK objects are transferred.
final class LucentCancellationSource: @unchecked Sendable {
  private let lock = NSLock()
  private var requested = false
  private var completed = false
  private var children: [LucentCancellationSource] = []
  var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return requested }
  func cancel() {
    lock.lock()
    requested = true
    let kids = children
    lock.unlock()
    for child in kids { child.cancel() }
  }
  func throwIfCancelled() throws {
    if cancelled { throw LucentError(code: "CANCELLED", message: "Native operation was cancelled") }
  }
  func scope() -> LucentCancellationSource {
    let child = LucentCancellationSource()
    lock.lock()
    children.append(child)
    let already = requested
    lock.unlock()
    if already { child.cancel() }
    return child
  }
  func finish() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if requested || completed { return false }
    completed = true
    return true
  }
}
`,
    },
    kotlin: {
      "Cancellation.kt": `package {{androidPackage}}
class LucentCancellationSource {
  private val lock = Any()
  private val requested = java.util.concurrent.atomic.AtomicBoolean(false)
  private var completed = false
  private val children = mutableListOf<LucentCancellationSource>()
  val cancelled: Boolean get() = requested.get()
  fun cancel() {
    val kids = synchronized(lock) { requested.set(true); children.toList() }
    kids.forEach { it.cancel() }
  }
  fun throwIfCancelled() {
    if (cancelled) throw LucentError("CANCELLED", "Native operation was cancelled")
  }
  fun scope(): LucentCancellationSource {
    val child = LucentCancellationSource()
    val already = synchronized(lock) { children.add(child); requested.get() }
    if (already) child.cancel()
    return child
  }
  fun finish(): Boolean = synchronized(lock) {
    if (requested.get() || completed) return false
    completed = true
    true
  }
}
`,
    },
  },
};
