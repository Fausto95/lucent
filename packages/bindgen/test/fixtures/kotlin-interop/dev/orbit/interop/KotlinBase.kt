package dev.orbit.interop

/** An open Kotlin class, which a Java class extends. */
open class KotlinBase {
  /** Nullability Java's annotations do not reach: a type argument's. */
  val tags: List<String?> = emptyList()

  /** A Boolean property whose getter keeps its name. */
  var isEnabled: Boolean = true

  open fun label(prefix: String = "kotlin"): String = prefix

  /** A type variable's value, which only Kotlin says is not made nullable here. */
  fun <T> identity(value: T): T = value

  suspend fun load(id: Int): String? = null

  /** Not API, though the JVM field holding it is public. */
  internal companion object {
    fun make(): KotlinBase = KotlinBase()
  }
}

/** A Kotlin class extending a Java class, overriding its method with Kotlin's nullability. */
class KotlinOnJava : JavaBase() {
  override fun describe(value: String): String = value
}
