import type { LibraryModule, NativeBinding } from "../libraries.ts";
const io = (
  capability: string,
  swift: string[],
  kotlin: string[],
  swiftImports: string[] = ["Foundation"],
): NativeBinding => ({
  swift,
  kotlin,
  swiftImports,
  capabilities: [capability],
  thread: "worker",
  cost: "io",
});
/** Native operations return owned buffers; no binary value passes through JSON. */
export const NATIVE_LIBRARIES: Readonly<Record<string, LibraryModule>> = {
  "@lucent-lang/core": {
    source:
      "export declare function encodeUTF8(text:string):Uint8Array; export declare function decodeUTF8(bytes:Uint8Array):string; export declare function copyBytes(bytes:Uint8Array):Uint8Array;",
    bindings: {
      encodeUTF8: {
        swift: ["return try LucentBytes.fromData(Data(text.utf8))"],
        kotlin: ["return LucentBytes.fromByteArray(text.toByteArray(Charsets.UTF_8))"],
        swiftImports: ["Foundation"],
      },
      decodeUTF8: {
        swift: ["return String(decoding: LucentBytes.data(bytes), as: UTF8.self)"],
        kotlin: ["return LucentBytes.toByteArray(bytes).toString(Charsets.UTF_8)"],
      },
      copyBytes: {
        swift: ["return try LucentBytes.fromData(LucentBytes.data(bytes))"],
        kotlin: ["return LucentBytes.fromByteArray(LucentBytes.toByteArray(bytes))"],
      },
    },
  },
  "@lucent-lang/filesystem": {
    source:
      "export declare function read(path:string):Promise<Uint8Array>; export declare function write(path:string,bytes:Uint8Array):Promise<void>; export declare function exists(path:string):Promise<boolean>; export declare function temporaryDirectory():Promise<string>;",
    bindings: {
      read: io(
        "filesystem",
        [
          "do { return try LucentBytes.fromData(Data(contentsOf: URL(fileURLWithPath: path))) }",
          'catch { throw LucentError(code: "FILE_READ", message: "Unable to read file", metadata: ["path": path]) }',
        ],
        [
          "try {",
          "  return LucentBytes.fromByteArray(java.io.File(path).readBytes())",
          "}",
          'catch (error: java.io.IOException) { throw LucentError("FILE_READ", "Unable to read file", mapOf("path" to path)) }',
        ],
      ),
      write: io(
        "filesystem",
        [
          "do { try LucentBytes.data(bytes).write(to: URL(fileURLWithPath: path), options: .atomic) }",
          'catch { throw LucentError(code: "FILE_WRITE", message: "Unable to write file", metadata: ["path": path]) }',
        ],
        [
          "try { java.io.File(path).writeBytes(LucentBytes.toByteArray(bytes)) }",
          'catch (error: java.io.IOException) { throw LucentError("FILE_WRITE", "Unable to write file", mapOf("path" to path)) }',
        ],
      ),
      temporaryDirectory: io(
        "filesystem",
        ["return NSTemporaryDirectory()"],
        [
          'return System.getProperty("java.io.tmpdir") ?: throw LucentError("FILE_TEMP", "Temporary directory unavailable")',
        ],
      ),
      exists: io(
        "filesystem",
        ["return FileManager.default.fileExists(atPath: path)"],
        ["return java.io.File(path).exists()"],
      ),
    },
  },
  "@lucent-lang/crypto": {
    source: "export declare function sha256(bytes:Uint8Array):string;",
    bindings: {
      sha256: {
        capabilities: ["crypto"],
        cost: "cpu",
        swiftImports: ["Foundation", "CryptoKit"],
        swift: ['return SHA256.hash(data: LucentBytes.data(bytes)).map { String(format: "%02x", $0) }.joined()'],
        kotlin: [
          'return java.security.MessageDigest.getInstance("SHA-256").digest(LucentBytes.toByteArray(bytes)).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, \'0\') }',
        ],
      },
    },
  },
  "@lucent-lang/network": {
    source: "export declare function get(url:string):Promise<Uint8Array>;",
    bindings: {
      get: io(
        "network",
        [
          'guard let target = URL(string: url), target.scheme == "https", target.host != nil else { throw LucentError(code: "INVALID_URL", message: "Expected an HTTPS URL") }',
          "do {",
          "  var request = URLRequest(url: target); request.timeoutInterval = 30",
          "  let (data, response) = try await URLSession.shared.data(for: request)",
          '  guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw LucentError(code: "HTTP_ERROR", message: "HTTP request failed", metadata: ["status": (response as? HTTPURLResponse)?.statusCode ?? 0]) }',
          "  return try LucentBytes.fromData(data)",
          "} catch let error as LucentError { throw error }",
          'catch { throw LucentError(code: "NETWORK_ERROR", message: "Network request failed") }',
        ],
        [
          'val target = try { java.net.URI(url).toURL() } catch (error: Exception) { throw LucentError("INVALID_URL", "Expected an HTTPS URL") }',
          'if (target.protocol != "https" || target.host.isEmpty()) throw LucentError("INVALID_URL", "Expected an HTTPS URL")',
          "var connection: javax.net.ssl.HttpsURLConnection? = null",
          "try {",
          "  connection = target.openConnection() as javax.net.ssl.HttpsURLConnection",
          "  connection.connectTimeout = 30000; connection.readTimeout = 30000",
          "  val status = connection.responseCode",
          '  if (status !in 200..299) throw LucentError("HTTP_ERROR", "HTTP request failed", mapOf("status" to status))',
          "  return connection.inputStream.use { LucentBytes.fromByteArray(it.readBytes()) }",
          '} catch (error: java.io.IOException) { throw LucentError("NETWORK_ERROR", "Network request failed") }',
          "finally { connection?.disconnect() }",
        ],
      ),
    },
  },
  "@lucent-lang/device": {
    source: "export declare function model():Promise<string>;",
    bindings: {
      model: {
        swift: ["return UIDevice.current.model"],
        kotlin: ["return android.os.Build.MODEL"],
        swiftImports: ["UIKit"],
        capabilities: ["device"],
        thread: "main",
      },
    },
  },
};
