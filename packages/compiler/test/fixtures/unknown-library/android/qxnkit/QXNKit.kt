// A library Lucent has never seen: a class hierarchy, a callback interface,
// a generic wrapper and a suspend function, whose names are drawn at random
// on every run ("QXN"/"qxn" is replaced).
package dev.qxn.kit

import dev.qxn.core.QXNUnit
import kotlinx.coroutines.delay

/** What the library's callers implement to hear from a gauge. */
interface QXNListener {
  fun qxnChanged(level: Double)
}

class QXNFailure(message: String) : Exception(message)

open class QXNBase(val qxnLabel: String) {
  open fun qxnDescribe(): String = "base $qxnLabel"
}

class QXNGauge(qxnLabel: String, qxnLevel: Double) : QXNBase(qxnLabel) {
  var qxnLevel: Double = qxnLevel
    private set

  var qxnListener: QXNListener? = null

  override fun qxnDescribe(): String = "gauge $qxnLabel at $qxnLevel"

  /** Moves the level, and tells the listener. */
  fun qxnBump(delta: Double) {
    qxnLevel += delta
    qxnListener?.qxnChanged(qxnLevel)
  }

  /** The unit, a type the library's dependency declares. */
  fun qxnUnit(): QXNUnit = QXNUnit("qxn")

  /** Twice the level, a moment later; fails below zero. */
  suspend fun qxnMeasure(): Double {
    delay(1)
    if (qxnLevel < 0) throw QXNFailure("negative")
    return qxnLevel * 2
  }
}

/** A generic wrapper: one item of any type. */
class QXNBox<Item>(val qxnItem: Item)
