@file:JvmName("Main")

package lucent.kotlinmetadata

import kotlin.system.exitProcess

/*
 * kotlin-metadata-reader [--iterations N] <jar|aar|dir>...
 *
 * Prints the normalized Kotlin metadata of every input as one JSON document
 * (packages/bindgen/src/kotlin-metadata.ts). With --iterations, extracts N
 * times in this process and reports each run's time on stderr, so a
 * benchmark can tell a cold JVM from a warm one.
 */

const val FORMAT = 1

fun main(args: Array<String>) {
  val iterations = if (args.firstOrNull() == "--iterations") args[1].toInt() else 1
  val inputs = if (args.firstOrNull() == "--iterations") args.drop(2) else args.toList()

  try {
    var batch: Json? = null
    repeat(iterations) { i ->
      val start = System.nanoTime()
      batch = extract(inputs)
      if (iterations > 1) System.err.println("iteration ${i + 1}: ${(System.nanoTime() - start) / 1_000_000.0} ms")
    }

    val out = StringBuilder()
    writeJson(batch, out)
    println(out)
  } catch (e: Exception) {
    System.err.println("kotlin-metadata-reader: ${e.message}")
    exitProcess(1)
  }
}

private fun extract(inputs: List<String>): Json = linkedMapOf(
  "format" to FORMAT,
  "inputs" to inputs.map { path ->
    val declarations = mutableListOf<Json>()
    forEachClassFile(path) { bytes ->
      val header = readMetadataHeader(bytes)
      if (header != null) normalize(header)?.let(declarations::add)
    }
    linkedMapOf("path" to path, "declarations" to declarations.sortedBy { it["jvmName"] as String })
  },
)
