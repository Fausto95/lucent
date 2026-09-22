package com.margelo.nitro.lucent

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

internal class LucentTaskRecord {
  var cancelled = false
  var finished = false
}

class LucentTaskScope {
  private val lock = Any()
  private var stopping = false
  private val records = mutableSetOf<LucentTaskRecord>()
  private val waiters = mutableListOf<Continuation<Unit>>()

  val closing: Boolean get() = synchronized(lock) { stopping }
  val activeCount: Double get() = synchronized(lock) { records.size.toDouble() }

  fun begin(): LucentTask = synchronized(lock) {
    if (stopping) throw LucentError("CLOSED_SCOPE", "Task scope no longer accepts work")

    val record = LucentTaskRecord()
    records.add(record)
    LucentTask(this, record)
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val ready = synchronized(lock) {
      stopping = true
      records.forEach { it.cancelled = true }

      if (records.isEmpty()) true else {
        waiters.add(continuation)
        false
      }
    }

    if (ready) continuation.resume(Unit)
  }

  internal fun cancelled(record: LucentTaskRecord): Boolean = synchronized(lock) { record.cancelled }

  internal fun finished(record: LucentTaskRecord): Boolean = synchronized(lock) { record.finished }

  internal fun cancel(record: LucentTaskRecord) = synchronized(lock) {
    if (!record.finished) record.cancelled = true
  }

  internal fun finish(record: LucentTaskRecord): Boolean {
    val (accepted, ready) = synchronized(lock) {
      if (record.finished) return false

      record.finished = true
      records.remove(record)

      val pending = if (stopping && records.isEmpty()) waiters.toList() else emptyList()
      if (stopping && records.isEmpty()) waiters.clear()

      Pair(!record.cancelled, pending)
    }

    ready.forEach { it.resume(Unit) }
    return accepted
  }
}

class LucentTask internal constructor(private val scope: LucentTaskScope, private val record: LucentTaskRecord) {
  val cancelled: Boolean get() = scope.cancelled(record)
  val finished: Boolean get() = scope.finished(record)

  fun cancel() { scope.cancel(record) }

  fun finish(): Boolean = scope.finish(record)

  fun throwIfCancelled() {
    if (cancelled) throw LucentError("CANCELLED", "Native task was cancelled")
  }
}
