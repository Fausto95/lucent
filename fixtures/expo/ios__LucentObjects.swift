import Foundation
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
final class LucentObjectRegistry: @unchecked Sendable {
  static let shared = LucentObjectRegistry()
  private let lock = NSRecursiveLock()
  private var leases = 0
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
  func release(_ handle: Double) { withLock {
    if let object = objects.removeValue(forKey: handle) { identities.removeValue(forKey: ObjectIdentifier(object)) }
  } }
}
