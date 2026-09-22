typealias ArrayBuffer = [UInt8]
{{runtime}}
{{packages}}
{{generated}}

final class RegistryFinalizer: NSObject {
  deinit {
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.global().async { _ = LucentObjectRegistry.shared.activeLeaseCount; done.signal() }
    precondition(done.wait(timeout: .now() + 5) == .success, "Deinitializer held registry lock")
  }
}

@main struct Runner {
  static func main() throws {
    let computed = try compute()
    precondition(computed == 10)
    let object = NSMutableString(string: "native")
    let registry = LucentObjectRegistry.shared
    let handle = registry.hold(object)
    precondition(handle == registry.hold(object))
    let lease = try registry.acquire(handle, NSMutableString.self)
    let retained = try lease.value
    precondition(retained === object)
    registry.release(handle)
    let pending = try lease.value
    precondition(pending === object)
    precondition(registry.activeLeaseCount == 1)
    lease.close()
    lease.close()
    precondition(registry.activeLeaseCount == 0)
    do { _ = try registry.get(handle, NSMutableString.self); fatalError("Released handle was accepted") } catch let error as LucentError { precondition(error.code == "DISPOSED_OBJECT") }
    do { _ = try lease.value; fatalError("Closed lease was accepted") } catch let error as LucentError { precondition(error.code == "DISPOSED_OBJECT") }
    DispatchQueue.concurrentPerform(iterations: 1000) { _ in
      let item = NSObject()
      let id = registry.hold(item)
      let pending = try! registry.acquire(id, NSObject.self)
      registry.release(id)
      pending.close()
    }
    precondition(registry.activeLeaseCount == 0)
    let groupHandle = registry.hold(object)
    let group = try registry.acquireMany([groupHandle, groupHandle])
    registry.release(groupHandle)
    let groupValue = try group.get(groupHandle, NSMutableString.self)
    precondition(groupValue === object)
    precondition(registry.activeLeaseCount == 1)
    group.close(); group.close()
    precondition(registry.activeLeaseCount == 0)
    let valid = registry.hold(object)
    do { _ = try registry.acquireMany([valid, -1]); fatalError("Invalid group accepted") } catch {}
    precondition(registry.activeLeaseCount == 0)
    registry.release(valid)
    func verifyOwnership() throws {
      var original: NSObject? = NSObject()
      weak var observed = original
      let id = registry.hold(original!)
      let pending = try registry.acquire(id, NSObject.self)
      original = nil
      registry.release(id)
      precondition(observed != nil)
      pending.close()
      precondition(observed == nil)
    }
    try verifyOwnership()
    let serialized = registry.hold(NSMutableString(string: ""))
    DispatchQueue.concurrentPerform(iterations: 1000) { _ in
      try! registry.withObjects([serialized, serialized]) { snapshot in
        let value = try snapshot.get(serialized, NSMutableString.self)
        value.append("x")
      }
    }
    let serialValue = try registry.get(serialized, NSMutableString.self)
    precondition(serialValue.length == 1000)
    let independent = registry.hold(NSObject())
    try registry.withObjects([serialized]) { snapshot in
      let done = DispatchSemaphore(value: 0)
      DispatchQueue.global().async {
        try! registry.withObjects([independent]) { _ in
          let temporary = registry.hold(NSObject())
          registry.release(temporary)
        }
        done.signal()
      }
      precondition(done.wait(timeout: .now() + 5) == .success, "SDK call held registry-wide synchronization")
      registry.release(serialized)
      let value = try snapshot.get(serialized, NSMutableString.self)
      precondition(value.length == 1000)
      let replacement = registry.hold(value)
      try registry.withObjects([replacement]) { nested in
        let nestedValue = try nested.get(replacement, NSMutableString.self); precondition(nestedValue === value)
      }
      registry.release(replacement)
    }
    registry.release(independent)
    precondition(registry.activeLeaseCount == 0)
    let throwing = registry.hold(NSObject())
    do { try registry.withObjects([throwing]) { _ in throw LucentError(code: "TEST", message: "failure") } } catch {}
    precondition(registry.activeLeaseCount == 0)
    registry.release(throwing)
    let finalizerHandle = registry.hold(RegistryFinalizer())
    registry.release(finalizerHandle)
    print("swift: native callbacks, identity, invalidation, lease ownership and 1000 concurrent releases passed")
  }
}
