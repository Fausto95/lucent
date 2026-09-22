// Implements the `@Native` declarations in toolkit.lucent.ts. The generated
// package declaration is prepended when this file omits one.

fun lucentNative_sha256(bytes: ArrayBuffer): String =
  java.security.MessageDigest.getInstance("SHA-256").digest(LucentBytes.toByteArray(bytes)).joinToString("") {
    (it.toInt() and 255).toString(16).padStart(2, '0')
  }

fun lucentNative_temporaryDirectory(): String =
  System.getProperty("java.io.tmpdir") ?: throw LucentError("FILE_TEMP", "Temporary directory unavailable")

fun lucentNative_writeFile(path: String, bytes: ArrayBuffer) {
  try {
    java.io.File(path).writeBytes(LucentBytes.toByteArray(bytes))
  } catch (error: java.io.IOException) {
    throw LucentError("FILE_WRITE", "Unable to write file", mapOf("path" to path))
  }
}

fun lucentNative_readFile(path: String): ArrayBuffer {
  try {
    return LucentBytes.fromByteArray(java.io.File(path).readBytes())
  } catch (error: java.io.IOException) {
    throw LucentError("FILE_READ", "Unable to read file", mapOf("path" to path))
  }
}

fun lucentNative_deviceModel(): String = android.os.Build.MODEL
