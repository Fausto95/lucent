package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Process-wide open camera session count for CI stubs (no physical camera). */
object LucentCameraCounts {
  private val lock = Any()
  private var sessions = 0
  private var frames = 0

  fun adjustSessions(delta: Int) = synchronized(lock) { sessions += delta }

  fun adjustFrames(delta: Int) = synchronized(lock) { frames += delta }

  val liveSessions: Double get() = synchronized(lock) { sessions.toDouble() }

  val liveFrames: Double get() = synchronized(lock) { frames.toDouble() }
}

/**
 * Synthetic camera frame buffer owned by the producer for the duration of a
 * frames callback. Keep-latest backpressure is package policy; this stub
 * delivers synchronously and counts drops under keep-latest pressure.
 */
class LucentCameraFrame(
  private val bytes: ByteArray,
  val width: Double,
  val height: Double,
  val rowStride: Double,
  val pixelStride: Double,
) {
  private var valid = true

  init {
    LucentCameraCounts.adjustFrames(1)
  }

  fun sample(index: Double): Double {
    if (!valid) throw LucentError("CLOSED_FRAME", "Frame buffer is no longer valid")
    if (index < 0 || index >= bytes.size || index.toInt().toDouble() != index) {
      throw LucentError("INVALID_FRAME", "Frame sample index out of range")
    }
    return (bytes[index.toInt()].toInt() and 255).toDouble()
  }

  fun close() {
    if (valid) {
      valid = false
      LucentCameraCounts.adjustFrames(-1)
    }
  }
}

/**
 * CI camera session stub. Feature orchestration stays in Lucent; this type tracks
 * start/stop/interrupt/restart/close and invokes a retained frames callback with
 * a borrowed synthetic buffer.
 */
class LucentCameraSession {
  private enum class State { IDLE, RUNNING, INTERRUPTED, CLOSED }

  private val lock = Any()
  private var state = State.IDLE
  private var interruptionReason = "none"
  private var framesCallback: ((LucentCameraFrame) -> Double)? = null
  private var delivering = false
  private var dropCount = 0.0

  init {
    LucentCameraCounts.adjustSessions(1)
  }

  val closed: Boolean
    get() = synchronized(lock) { state == State.CLOSED }

  val interrupted: Boolean
    get() = synchronized(lock) { state == State.INTERRUPTED }

  val interruptionReasonValue: String
    get() = synchronized(lock) { interruptionReason }

  fun droppedFrames(): Double = synchronized(lock) { dropCount }

  fun resetDropCounter() = synchronized(lock) { dropCount = 0.0 }

  fun start() {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Camera session is closed")
      state = State.RUNNING
      interruptionReason = "none"
    }
  }

  fun stop() {
    synchronized(lock) {
      if (state == State.CLOSED) return
      state = State.IDLE
      interruptionReason = "none"
    }
  }

  /** Stub interruption (audio / system / background). Contract-tested in CI. */
  fun interrupt(reason: String) {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Camera session is closed")
      if (state != State.RUNNING && state != State.INTERRUPTED) {
        throw LucentError("NOT_RUNNING", "Camera session is not running")
      }
      state = State.INTERRUPTED
      interruptionReason = reason
    }
  }

  /** Clear interruption and return to running. */
  fun restart() {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Camera session is closed")
      if (state != State.INTERRUPTED && state != State.RUNNING) {
        throw LucentError("NOT_RUNNING", "Camera session is not running")
      }
      state = State.RUNNING
      interruptionReason = "none"
    }
  }

  /**
   * Retain `callback` for the subscription lifetime. Package policy is
   * backpressure "latest" (worker executor, notify errors).
   */
  fun frames(callback: (LucentCameraFrame) -> Double): Double {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Camera session is closed")
      framesCallback = callback
    }
    return 1.0
  }

  /**
   * Deliver one synthetic frame. Keep-latest: if a delivery is already in flight
   * or the session is interrupted, increment the drop counter and skip.
   */
  fun deliverSynthetic(bytes: ByteArray, width: Double, height: Double, rowStride: Double, pixelStride: Double): Double {
    val callback = synchronized(lock) {
      if (state == State.INTERRUPTED) {
        dropCount += 1.0
        return 0.0
      }
      if (state != State.RUNNING) throw LucentError("NOT_RUNNING", "Camera session is not running")
      if (delivering) {
        dropCount += 1.0
        return 0.0
      }
      val cb = framesCallback ?: throw LucentError("NO_CALLBACK", "No frames subscription")
      delivering = true
      cb
    }
    val frame = LucentCameraFrame(bytes, width, height, rowStride, pixelStride)
    try {
      return callback(frame)
    } finally {
      frame.close()
      synchronized(lock) { delivering = false }
    }
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val release = synchronized(lock) {
      if (state == State.CLOSED) false
      else {
        state = State.CLOSED
        framesCallback = null
        interruptionReason = "none"
        true
      }
    }
    if (release) LucentCameraCounts.adjustSessions(-1)
    continuation.resume(Unit)
  }
}

object LucentCamera {
  private val lock = Any()
  private var permission = "granted"

  fun requestPermission(): String = synchronized(lock) { permission }

  fun permissionState(): String = synchronized(lock) { permission }

  /** CI-only: set the stub permission union state. */
  fun setPermission(state: String) = synchronized(lock) { permission = state }
}
