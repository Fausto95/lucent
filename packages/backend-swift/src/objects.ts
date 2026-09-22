import type { IRStruct } from "@lucent-lang/compiler";
import { swiftType } from "./types.ts";
export function swiftClass(s: IRStruct): string {
  const native = s.reference?.native;
  if (native)
    return native.swift
      ? [...(native.swiftImports ?? []).map((i) => `import ${i}`), `typealias ${s.name} = ${native.swift}`, ""].join(
          "\n",
        )
      : `final class ${s.name} {}\n`;

  return `final class ${s.name} {\n${s.fields.map((f) => `  var ${f.name}: ${swiftType(f.type)}`).join("\n")}\n  init(${s.fields.map((f) => `${f.name}: ${swiftType(f.type)}`).join(", ")}) {\n${s.fields.map((f) => `    self.${f.name} = ${f.name}`).join("\n")}\n  }\n}\n`;
}
export const swiftObjectRuntime = `import Foundation
final class LucentObjectLease<T: AnyObject> {
  private let lock = NSLock()
  private var object: T?
  private var cleanup: (() -> Void)?
  init(_ object: T, cleanup: @escaping () -> Void) { self.object = object; self.cleanup = cleanup }
  var value: T { get throws {
    lock.lock(); defer { lock.unlock() }
    guard let object else { throw LucentError(code: "DISPOSED_OBJECT", message: "Native lease is closed") }
    return object
  } }
  func close() {
    lock.lock()
    let action = cleanup
    let retained = object
    cleanup = nil; object = nil
    lock.unlock()
    withExtendedLifetime(retained) { action?() }
  }
  deinit { close() }
}
// The compiler only sends groups across executors for explicitly transferable SDK objects.
final class LucentObjectLeaseGroup: @unchecked Sendable {
  private let lock = NSLock()
  private var leases: [Double: LucentObjectLease<AnyObject>]
  init(_ leases: [Double: LucentObjectLease<AnyObject>]) { self.leases = leases }
  func get<T: AnyObject>(_ handle: Double, _ type: T.Type) throws -> T {
    lock.lock(); defer { lock.unlock() }
    guard let lease = leases[handle], let value = try lease.value as? T else {
      throw LucentError(code: "DISPOSED_OBJECT", message: "Invalid or closed native lease")
    }
    return value
  }
  func close() {
    lock.lock(); let pending = leases; leases = [:]; lock.unlock()
    pending.values.forEach { $0.close() }
  }
  deinit { close() }
}
private final class LucentObjectSerialization {
  weak var object: AnyObject?
  let lock = NSRecursiveLock()
  let order: Int
  init(_ object: AnyObject, _ order: Int) { self.object = object; self.order = order }
}
final class LucentObjectRegistry: @unchecked Sendable {
  static let shared = LucentObjectRegistry()
  private let lock = NSRecursiveLock()
  private var leases = 0
  private var serializationOrder = 0
  private var serialization: [ObjectIdentifier: LucentObjectSerialization] = [:]
  var activeLeaseCount: Int { withLock { leases } }
  private var next: Double = 0
  private var objects: [Double: AnyObject] = [:]
  private var identities: [ObjectIdentifier: Double] = [:]
  func withLock<T>(_ body: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try body() }
  func hold(_ object: AnyObject) -> Double { withLock {
    let identity = ObjectIdentifier(object)
    if let handle = identities[identity] { return handle }
    next += 1
    objects[next] = object; identities[identity] = next
    return next
  } }
  func get<T: AnyObject>(_ handle: Double, _ type: T.Type) throws -> T { try withLock {
    guard let object = objects[handle] as? T else { throw LucentError(code: "DISPOSED_OBJECT", message: "Invalid or released native object") }
    return object
  } }
  func acquire<T: AnyObject>(_ handle: Double, _ type: T.Type) throws -> LucentObjectLease<T> { try withLock {
    let object = try get(handle, type)
    leases += 1
    return LucentObjectLease(object) { self.withLock { self.leases -= 1 } }
  } }
  func acquireMany(_ handles: [Double]) throws -> LucentObjectLeaseGroup { try withLock {
    var pending: [Double: LucentObjectLease<AnyObject>] = [:]
    for handle in Set(handles) { pending[handle] = try acquire(handle, AnyObject.self) }
    return LucentObjectLeaseGroup(pending)
  } }
  // Snapshot under the registry lock; invoke SDK code only under object locks.
  func withObjects<T>(_ handles: [Double], _ body: (LucentObjectLeaseGroup) throws -> T) throws -> T {
    let (group, locks) = try withLock { () throws -> (LucentObjectLeaseGroup, [LucentObjectSerialization]) in
      let group = try acquireMany(handles)
      serialization = serialization.filter { $0.value.object != nil }
      var unique: [ObjectIdentifier: LucentObjectSerialization] = [:]
      for handle in Set(handles) {
        let object = try group.get(handle, AnyObject.self)
        let identity = ObjectIdentifier(object)
        if serialization[identity] == nil {
          serializationOrder += 1
          serialization[identity] = LucentObjectSerialization(object, serializationOrder)
        }
        unique[identity] = serialization[identity]!
      }
      return (group, unique.values.sorted { $0.order < $1.order })
    }
    for entry in locks { entry.lock.lock() }
    defer {
      for entry in locks.reversed() { entry.lock.unlock() }
      group.close()
    }
    return try body(group)
  }
  func release(_ handle: Double) {
    let retained: AnyObject? = withLock {
      let object = objects.removeValue(forKey: handle)
      if let object { identities.removeValue(forKey: ObjectIdentifier(object)) }
      return object
    }
    // Native deinitializers can call back into the registry on another executor.
    withExtendedLifetime(retained) {}
  }
}
`;
