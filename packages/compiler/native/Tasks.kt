package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.startCoroutine
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.yield

class LucentTaskRecord {
  var cancelled = false
  var finished = false
}

interface LucentTaskHost {
  fun hostCancelled(record: LucentTaskRecord): Boolean
  fun hostFinished(record: LucentTaskRecord): Boolean
  fun hostCancel(record: LucentTaskRecord)
  fun hostFinish(record: LucentTaskRecord): Boolean
  fun hostFail(record: LucentTaskRecord, error: Throwable)
}

class LucentTaskScope : LucentTaskHost {
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

  override fun hostCancelled(record: LucentTaskRecord): Boolean = cancelled(record)
  override fun hostFinished(record: LucentTaskRecord): Boolean = finished(record)
  override fun hostCancel(record: LucentTaskRecord) = cancel(record)
  override fun hostFinish(record: LucentTaskRecord): Boolean = finish(record)
  override fun hostFail(record: LucentTaskRecord, error: Throwable) {
    cancel(record)
    finish(record)
  }
}

/** Structured task group: first child failure cancels siblings; `close` awaits quiescence and rethrows. */
class LucentTaskGroup : LucentTaskHost {
  private val lock = Any()
  private var stopping = false
  private val records = mutableSetOf<LucentTaskRecord>()
  private val waiters = mutableListOf<Continuation<Unit>>()
  private var primaryError: Throwable? = null

  val closing: Boolean get() = synchronized(lock) { stopping }
  val activeCount: Double get() = synchronized(lock) { records.size.toDouble() }

  fun begin(): LucentTask = synchronized(lock) {
    if (stopping) throw LucentError("CLOSED_SCOPE", "Task group no longer accepts work")

    val record = LucentTaskRecord()
    records.add(record)
    LucentTask(this, record)
  }

  /** Spawn async child work. On throw, cancel siblings and record the primary error. */
  fun run(body: suspend () -> Unit) {
    val child = begin()
    val block: suspend () -> Unit = {
      try {
        body()
        child.finish()
      } catch (error: Throwable) {
        child.fail(error)
      }
    }
    block.startCoroutine(object : Continuation<Unit> {
      override val context = EmptyCoroutineContext
      override fun resumeWith(result: Result<Unit>) {
        result.exceptionOrNull()?.let { child.fail(it) }
      }
    })
  }

  suspend fun close() {
    suspendCoroutine { continuation ->
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

    val error = synchronized(lock) { primaryError }
    if (error != null) throw error
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

  internal fun fail(record: LucentTaskRecord, error: Throwable) {
    synchronized(lock) {
      if (primaryError == null) primaryError = error
      records.forEach { other ->
        if (other !== record && !other.finished) other.cancelled = true
      }
    }
    finish(record)
  }

  override fun hostCancelled(record: LucentTaskRecord): Boolean = cancelled(record)
  override fun hostFinished(record: LucentTaskRecord): Boolean = finished(record)
  override fun hostCancel(record: LucentTaskRecord) = cancel(record)
  override fun hostFinish(record: LucentTaskRecord): Boolean = finish(record)
  override fun hostFail(record: LucentTaskRecord, error: Throwable) = fail(record, error)
}

class LucentTask internal constructor(private val host: LucentTaskHost, private val record: LucentTaskRecord) {
  val cancelled: Boolean get() = host.hostCancelled(record)
  val finished: Boolean get() = host.hostFinished(record)

  fun cancel() { host.hostCancel(record) }

  fun finish(): Boolean = host.hostFinish(record)

  /** Record failure: for a task group, cancels siblings and stores the primary error. */
  fun fail(error: Throwable) { host.hostFail(record, error) }

  fun throwIfCancelled() {
    if (cancelled) throw LucentError("CANCELLED", "Native task was cancelled")
  }
}

/**
 * Runs an async component effect under a [LucentTaskScope]: cancel/join previous
 * work, then await cleanup, before the next generation or unmount completes.
 */
object LucentEffectRunner {
  suspend fun run(setup: suspend () -> Unit, cleanup: suspend () -> Unit) {
    val scope = LucentTaskScope()
    val child = try {
      scope.begin()
    } catch (_: Throwable) {
      null
    }
    try {
      setup()
      yield()
      while (true) {
        child?.throwIfCancelled()
        delay(Long.MAX_VALUE / 2)
      }
    } catch (_: CancellationException) {
      child?.cancel()
    } catch (_: Throwable) {
      // Setup failure — still run cleanup and join the scope.
    }
    try {
      cleanup()
    } catch (_: Throwable) {
    }
    child?.finish()
    scope.close()
  }
}
