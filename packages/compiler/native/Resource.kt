package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Process-wide live resource and lease counts for the Lucent resource runtime. */
object LucentResourceCounts {
  private val lock = Any()
  private var resources = 0
  private var leases = 0

  fun adjustResources(delta: Int) = synchronized(lock) { resources += delta }

  fun adjustLeases(delta: Int) = synchronized(lock) { leases += delta }

  val liveResources: Double get() = synchronized(lock) { resources.toDouble() }

  val liveLeases: Double get() = synchronized(lock) { leases.toDouble() }
}

/** Development executor checks (P41). Used by adapters such as FakeUIObject. */
object LucentExecutor {
  fun requireMain() {
    if (Thread.currentThread().name != "main" && !isLikelyMain()) {
      throw LucentError(
        "EXECUTOR_ERROR",
        "Requires MainExecutor; current thread is not the main thread",
      )
    }
  }

  private fun isLikelyMain(): Boolean {
    // Android Looper check when available; otherwise accept JVM main.
    return try {
      val looper = Class.forName("android.os.Looper")
      val getMain = looper.getMethod("getMainLooper")
      val getMine = looper.getMethod("myLooper")
      getMain.invoke(null) == getMine.invoke(null)
    } catch (_: Throwable) {
      Thread.currentThread().name == "main"
    }
  }
}

/**
 * Owned resource wrapper: OPEN → CLOSING → CLOSED with operation leases.
 *
 * `close()` never waits synchronously on the caller that holds a lease; waiters
 * resume asynchronously so a callback that requests close cannot deadlock itself.
 */
class LucentResource {
  private enum class State { OPEN, CLOSING, CLOSED }

  private val lock = Any()
  private var state = State.OPEN
  private var leases = 0
  private val closeWaiters = mutableListOf<Continuation<Unit>>()

  /** Optional debug labels for lifetime sanitizer messages (P41). */
  @Volatile var createdAt: String = defaultLabel()
  @Volatile var closedAt: String = ""

  init {
    LucentResourceCounts.adjustResources(1)
  }

  companion object {
    fun defaultLabel(): String {
      val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      fmt.timeZone = TimeZone.getTimeZone("UTC")
      return fmt.format(Date())
    }
  }

  val closed: Boolean get() = synchronized(lock) { state == State.CLOSED }

  val leaseCount: Double get() = synchronized(lock) { leases.toDouble() }

  private fun lifetimeMessage(action: String): String {
    val parts = mutableListOf("Resource $action")
    if (createdAt.isNotEmpty()) parts.add("createdAt: $createdAt")
    if (closedAt.isNotEmpty()) parts.add("closedAt: $closedAt")
    return parts.joinToString("; ")
  }

  fun beginOperation() = synchronized(lock) {
    when (state) {
      State.CLOSED -> throw LucentError("LIFETIME_ERROR", lifetimeMessage("used after close"))
      State.CLOSING -> throw LucentError("CLOSED", "Resource no longer accepts work")
      State.OPEN -> {
        leases += 1
        LucentResourceCounts.adjustLeases(1)
      }
    }
  }

  fun endOperation() {
    val shouldFinish = synchronized(lock) {
      if (leases == 0) return
      leases -= 1
      LucentResourceCounts.adjustLeases(-1)
      state == State.CLOSING && leases == 0
    }
    if (shouldFinish) finishClose()
  }

  /** Optional SDK cleanup hook for adapters. Must leave the resource terminal. */
  fun cleanup() {}

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val resumeNow = synchronized(lock) {
      when (state) {
        State.CLOSED -> true
        State.CLOSING -> {
          closeWaiters.add(continuation)
          false
        }
        State.OPEN -> {
          state = State.CLOSING
          if (leases == 0) {
            // finishClose resumes this continuation
            null
          } else {
            closeWaiters.add(continuation)
            false
          }
        }
      }
    }
    when (resumeNow) {
      true -> continuation.resume(Unit)
      false -> {}
      null -> finishClose(resuming = continuation)
    }
  }

  private fun finishClose(resuming: Continuation<Unit>? = null) {
    cleanup()
    val waiters = synchronized(lock) {
      state = State.CLOSED
      if (closedAt.isEmpty()) closedAt = defaultLabel()
      val pending = closeWaiters.toList()
      closeWaiters.clear()
      pending
    }
    resuming?.resume(Unit)
    waiters.forEach { it.resume(Unit) }
  }
}

/** Tracks owned resources and closes them in reverse order of [own]. */
class LucentResourceBag {
  private val lock = Any()
  private val owned = mutableListOf<LucentResource>()

  fun own(resource: LucentResource): LucentResource = synchronized(lock) {
    owned.add(resource)
    resource
  }

  suspend fun closeAll() {
    val resources = synchronized(lock) {
      val copy = owned.asReversed().toList()
      owned.clear()
      copy
    }
    for (resource in resources) {
      resource.close()
    }
  }
}

/** Runs [body] then awaits [LucentResource.close] on every exit path. */
object LucentResourceScope {
  suspend fun withResource(resource: LucentResource, body: (LucentResource) -> Unit) {
    try {
      body(resource)
    } finally {
      resource.close()
    }
  }

  /** Runs [body] with a bag that owns resources; closes them in reverse order on every exit. */
  suspend fun resourceScope(body: (LucentResourceBag) -> Unit) {
    val scope = LucentResourceBag()
    try {
      body(scope)
    } finally {
      scope.closeAll()
    }
  }
}
