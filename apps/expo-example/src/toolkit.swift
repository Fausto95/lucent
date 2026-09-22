import Foundation
import CryptoKit
import UIKit

// Implements the `@Native` declarations in toolkit.lucent.ts. Each function is
// `throws` because the generated caller marks every native call with `try`.

func lucentNative_sha256(bytes: ArrayBuffer) throws -> String {
  return SHA256.hash(data: LucentBytes.data(bytes)).map { String(format: "%02x", $0) }.joined()
}

func lucentNative_temporaryDirectory() throws -> String {
  return NSTemporaryDirectory()
}

func lucentNative_writeFile(path: String, bytes: ArrayBuffer) throws -> Void {
  do {
    try LucentBytes.data(bytes).write(to: URL(fileURLWithPath: path), options: .atomic)
  } catch {
    throw LucentError(code: "FILE_WRITE", message: "Unable to write file", metadata: ["path": path])
  }
}

func lucentNative_readFile(path: String) throws -> ArrayBuffer {
  do {
    return try LucentBytes.fromData(Data(contentsOf: URL(fileURLWithPath: path)))
  } catch {
    throw LucentError(code: "FILE_READ", message: "Unable to read file", metadata: ["path": path])
  }
}

@MainActor
func lucentNative_deviceModel() throws -> String {
  return UIDevice.current.model
}
