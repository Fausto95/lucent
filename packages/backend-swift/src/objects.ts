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
final class LucentObjectRegistry: @unchecked Sendable {
  static let shared = LucentObjectRegistry()
  private let lock = NSRecursiveLock()
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
  func release(_ handle: Double) { withLock {
    if let object = objects.removeValue(forKey: handle) { identities.removeValue(forKey: ObjectIdentifier(object)) }
  } }
}
`;
