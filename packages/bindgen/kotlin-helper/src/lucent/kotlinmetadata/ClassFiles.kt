package lucent.kotlinmetadata

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream
import kotlin.metadata.jvm.Metadata

/** The `@kotlin.Metadata` annotation of one class file, read from its bytes. */
class MetadataHeader(val jvmName: String, val metadata: Metadata)

/**
 * Calls [visit] with every class file of a jar, an AAR (its classes.jar and
 * libs/\*.jar) or a directory, in archive or walk order. Entries under
 * META-INF (multi-release copies, module-info) are skipped.
 */
fun forEachClassFile(path: String, visit: (ByteArray) -> Unit) {
  val file = File(path)

  when {
    file.isDirectory ->
      file.walkTopDown()
        .filter { it.isFile && it.name.endsWith(".class") }
        .sortedBy { it.relativeTo(file).invariantSeparatorsPath }
        .forEach { visit(it.readBytes()) }

    path.endsWith(".aar") ->
      ZipFile(file).use { aar ->
        for (entry in aar.entries()) {
          val inner = entry.name == "classes.jar" || (entry.name.startsWith("libs/") && entry.name.endsWith(".jar"))
          if (!inner) continue

          ZipInputStream(aar.getInputStream(entry)).use { jar ->
            while (true) {
              val classEntry = jar.nextEntry ?: break
              if (isClassEntry(classEntry.name)) visit(jar.readBytes())
            }
          }
        }
      }

    else ->
      ZipFile(file).use { jar ->
        for (entry in jar.entries()) {
          if (isClassEntry(entry.name)) visit(jar.getInputStream(entry).readBytes())
        }
      }
  }
}

private fun isClassEntry(name: String) = name.endsWith(".class") && !name.startsWith("META-INF/")

/**
 * Reads the class name and the `@kotlin.Metadata` element values from class
 * file bytes (JVMS §4): the constant pool, then the class attributes. No class
 * is loaded. Returns null for a class without Kotlin metadata.
 */
fun readMetadataHeader(bytes: ByteArray): MetadataHeader? {
  val buf = ByteBuffer.wrap(bytes)
  require(buf.getInt() == 0xCAFEBABE.toInt()) { "not a class file" }
  buf.position(8)

  val pool = ConstantPool(bytes, buf)

  buf.getShort() // access flags
  val jvmName = pool.className(buf.u2())
  buf.getShort() // super class
  val interfaces = buf.u2()
  buf.position(buf.position() + 2 * interfaces)

  repeat(2) { // fields, then methods
    repeat(buf.u2()) {
      buf.position(buf.position() + 6)
      skipAttributes(buf)
    }
  }

  repeat(buf.u2()) {
    val name = pool.utf8(buf.u2())
    val length = buf.getInt()
    val end = buf.position() + length

    if (name == "RuntimeVisibleAnnotations") {
      repeat(buf.u2()) {
        val metadata = readAnnotation(buf, pool)
        if (metadata != null) return MetadataHeader(jvmName, metadata)
      }
    }

    buf.position(end)
  }

  return null
}

private fun skipAttributes(buf: ByteBuffer) {
  repeat(buf.u2()) {
    buf.getShort()
    val length = buf.getInt()
    buf.position(buf.position() + length)
  }
}

/** Reads one annotation; returns its values when it is `@kotlin.Metadata`, skipping it otherwise. */
private fun readAnnotation(buf: ByteBuffer, pool: ConstantPool): Metadata? {
  val type = pool.utf8(buf.u2())
  val pairs = buf.u2()

  if (type != "Lkotlin/Metadata;") {
    repeat(pairs) {
      buf.getShort()
      skipElementValue(buf)
    }

    return null
  }

  var kind: Int? = null
  var version: IntArray? = null
  var data1: Array<String>? = null
  var data2: Array<String>? = null
  var extraString: String? = null
  var packageName: String? = null
  var extraInt: Int? = null

  repeat(pairs) {
    when (pool.utf8(buf.u2())) {
      "k" -> kind = pool.int(constIndex(buf))
      "mv" -> version = array(buf) { pool.int(constIndex(buf)) }.toIntArray()
      "d1" -> data1 = array(buf) { pool.utf8(constIndex(buf)) }.toTypedArray()
      "d2" -> data2 = array(buf) { pool.utf8(constIndex(buf)) }.toTypedArray()
      "xs" -> extraString = pool.utf8(constIndex(buf))
      "pn" -> packageName = pool.utf8(constIndex(buf))
      "xi" -> extraInt = pool.int(constIndex(buf))
      else -> skipElementValue(buf)
    }
  }

  return Metadata(
    kind = kind,
    metadataVersion = version,
    data1 = data1,
    data2 = data2,
    extraString = extraString,
    packageName = packageName,
    extraInt = extraInt,
  )
}

private fun constIndex(buf: ByteBuffer): Int {
  buf.get() // the element value tag: I or s here
  return buf.u2()
}

private fun <T> array(buf: ByteBuffer, element: () -> T): List<T> {
  require(buf.get().toInt().toChar() == '[') { "kotlin.Metadata: expected an array" }
  return List(buf.u2()) { element() }
}

private fun skipElementValue(buf: ByteBuffer) {
  when (val tag = buf.get().toInt().toChar()) {
    'B', 'C', 'D', 'F', 'I', 'J', 'S', 'Z', 's', 'c' -> buf.getShort()
    'e' -> buf.getInt()
    '@' -> {
      buf.getShort()
      repeat(buf.u2()) {
        buf.getShort()
        skipElementValue(buf)
      }
    }
    '[' -> repeat(buf.u2()) { skipElementValue(buf) }
    else -> throw IllegalArgumentException("class file: element value tag $tag")
  }
}

private fun ByteBuffer.u2(): Int = getShort().toInt() and 0xFFFF

/** Constant pool offsets; strings are decoded (as modified UTF-8) only when asked for. */
private class ConstantPool(private val bytes: ByteArray, buf: ByteBuffer) {
  private val offsets: IntArray
  private val tags: ByteArray

  init {
    val count = buf.u2()
    offsets = IntArray(count)
    tags = ByteArray(count)

    var i = 1
    while (i < count) {
      val tag = buf.get()
      tags[i] = tag
      offsets[i] = buf.position()

      val size = when (tag.toInt()) {
        1 -> 2 + (buf.getShort(buf.position()).toInt() and 0xFFFF)
        3, 4, 9, 10, 11, 12, 17, 18 -> 4
        5, 6 -> 8
        7, 8, 16, 19, 20 -> 2
        15 -> 3
        else -> throw IllegalArgumentException("class file: unknown constant tag $tag")
      }
      buf.position(buf.position() + size)
      i += if (tag.toInt() == 5 || tag.toInt() == 6) 2 else 1
    }
  }

  fun utf8(index: Int): String {
    require(tags[index].toInt() == 1) { "class file: constant $index is not a string" }
    return DataInputStream(ByteArrayInputStream(bytes, offsets[index], bytes.size - offsets[index])).readUTF()
  }

  fun int(index: Int): Int {
    require(tags[index].toInt() == 3) { "class file: constant $index is not an int" }
    return ByteBuffer.wrap(bytes, offsets[index], 4).getInt()
  }

  fun className(index: Int): String = utf8(ByteBuffer.wrap(bytes, offsets[index], 2).u2())
}
