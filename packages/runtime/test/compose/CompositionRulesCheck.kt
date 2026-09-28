// The rules of a component's composition (CompositionRules.kt), checked on
// the JVM: compose-host.test.ts compiles this beside them and runs main.
package dev.lucent.compose

private val failures = mutableListOf<String>()

private fun check(what: String, actual: Any?, expected: Any?) {
  if (actual != expected) failures += "$what: $actual, expected $expected"
}

/** An owner kind and objects standing in for a host's contexts, as plain classes. */
private interface Owner

private class Activity : Owner

private class Wrapper

private fun turns() {
  val first = CompositionTurns()

  check("first attach starts the composition", first.attached(), true)
  check("a detach and attach keep it", first.attached(), false)
  check("the mount's end disposes it", first.ended(), true)
  check("a second end does nothing", first.ended(), false)
  check("an attach after the end does nothing", first.attached(), false)

  val never = CompositionTurns()

  check("a mount ending before any attach disposes nothing", never.ended(), false)
  check("its view never composes", never.attached(), false)
}

private fun owners() {
  val tree = Activity()
  val activity = Activity()

  check("the view tree's owner first", firstOwner(Owner::class.java, tree, sequenceOf(activity)), tree)
  check(
    "else the first of the host's contexts that is one",
    firstOwner(Owner::class.java, null, sequenceOf(Wrapper(), activity, Activity())),
    activity,
  )
  check("else none", firstOwner(Owner::class.java, null, sequenceOf(Wrapper())), null)
}

fun main() {
  turns()
  owners()

  if (failures.isNotEmpty()) {
    System.err.println(failures.joinToString("\n"))
    kotlin.system.exitProcess(1)
  }

  println("ok")
}
