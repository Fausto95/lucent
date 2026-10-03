// The library's view: an android.view.View subclass whose turns call back
// ("QXN"/"qxn" is replaced on every run).
package dev.qxn.dials

import android.content.Context
import android.view.View

/** What a dial calls when turned. */
fun interface QXNTurnListener {
  fun qxnTurned(level: Double)
}

class QXNDial(context: Context) : View(context) {
  var qxnLevel: Double = 0.0

  private var listener: QXNTurnListener? = null

  /** Calls `listener` on every turn; null stops (as View.setOnClickListener does). */
  fun qxnSetOnTurn(listener: QXNTurnListener?) {
    this.listener = listener
  }

  /** Turns the dial, and calls back with its new level. */
  fun qxnTurn(delta: Double) {
    qxnLevel += delta
    listener?.qxnTurned(qxnLevel)
  }
}
