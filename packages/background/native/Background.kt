package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** CI stub that records scheduled background jobs (durable and in-process). */
object LucentBackground {
  private val lock = Any()
  private val jobs = mutableMapOf<String, Triple<Double, Boolean, String>>()
  private var runCount = 0.0

  fun schedule(jobId: String, payloadVersion: Double, payload: String, durable: Boolean): LucentBackgroundJobHandle {
    synchronized(lock) { jobs[jobId] = Triple(payloadVersion, durable, payload) }
    return LucentBackgroundJobHandle(jobId, payloadVersion, durable, payload)
  }

  fun scheduledCount(): Double = synchronized(lock) { jobs.size.toDouble() }

  fun runCountValue(): Double = synchronized(lock) { runCount }

  fun remove(jobId: String) {
    synchronized(lock) { jobs.remove(jobId) }
  }

  /** Run a scheduled job once. Rejects if `expectedVersion` does not match. */
  fun runOnce(jobId: String, expectedVersion: Double): Double {
    synchronized(lock) {
      val job = jobs[jobId] ?: throw LucentError("NOT_SCHEDULED", "Job is not scheduled")
      if (job.first != expectedVersion) throw LucentError("VERSION_MISMATCH", "Payload version mismatch")
      runCount += 1.0
      return job.first
    }
  }
}

class LucentBackgroundJobHandle(
  val jobId: String,
  val payloadVersion: Double,
  val durable: Boolean,
  private val payload: String,
) {
  private val lock = Any()
  private var isClosed = false
  private var cancelled = false

  val closed: Boolean
    get() = synchronized(lock) { isClosed }

  fun cancel() {
    synchronized(lock) { cancelled = true }
    LucentBackground.remove(jobId)
  }

  /** Run this handle's payload once if still scheduled and version matches. */
  fun runOnce(): Double {
    val cancelledNow = synchronized(lock) { cancelled || isClosed }
    if (cancelledNow) throw LucentError("CANCELLED", "Job was cancelled")
    return LucentBackground.runOnce(jobId, payloadVersion)
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    synchronized(lock) { isClosed = true }
    continuation.resume(Unit)
  }
}
