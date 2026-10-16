@file:JvmName("Greetings")

package dev.example.greet

import dev.example.greet.java.Polite

/** Greets one name: a class, its property and methods, as Lucent binds them. */
class Greeter(val name: String) {
  private val heard = mutableListOf<String>()

  /** The name's length: a property Kotlin infers the type of. */
  val length get() = name.length

  fun greet(): String = "hello $name"

  /** Remembers who it heard, which `heard` lists. */
  fun hear(who: String) {
    heard += who
  }

  fun heard(): String = heard.joinToString(",")

  /** Java's greeting, from the Java beside it. */
  fun polite(): String = Polite.greet(this)
}

/** A top-level function with a default, which Lucent calls through a Kotlin shim. */
fun greeting(of: String = "you"): String = "hi $of"
