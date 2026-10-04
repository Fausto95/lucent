// The shapes a Kotlin shim finishes (TA31): generic members whose type
// parameters have bounds, value classes assigned, and interfaces whose
// members suspend or take value classes, implemented by Lucent classes.
package dev.shims.board

/** A value class: the JVM passes an Int where Kotlin sees Score. */
@JvmInline
value class Score(val points: Int)

/** What a Lucent class implements: a member taking and giving a value class, and a suspend one. */
interface Judge {
  fun judge(score: Score): Score

  /** An object result. */
  fun crown(board: Board): Board

  suspend fun pick(names: List<String>): String
}

class Board {
  /** A value class property, assigned through its setter. */
  var best: Score = Score(0)

  /** A suspend function generic in a bounded type parameter. */
  suspend fun <T : Comparable<T>> top(items: List<T>): T? = items.maxOrNull()

  /** A bounded generic function, its default left out. */
  fun <T : Comparable<T>> lowest(items: List<T>, skip: Int = 0): T = items.sorted()[skip]

  /** Asks a judge: its value-class member, then its suspend one. */
  suspend fun ask(judge: Judge, names: List<String>): String =
    "${judge.judge(Score(2)).points} ${judge.crown(this) === this} ${judge.pick(names)}"
}

/** A class generic in a bounded type parameter: its suspend member through a shim. */
class Ranked<T : Comparable<T>>(val items: List<T>) {
  suspend fun best(): T = items.max()
}
