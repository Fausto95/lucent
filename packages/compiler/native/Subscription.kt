package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Process-wide live subscription and in-flight delivery counts. */
object LucentSubscriptionCounts {
  private val lock = Any()
  private var subscriptions = 0
  private var deliveries = 0

  fun adjustSubscriptions(delta: Int) = synchronized(lock) { subscriptions += delta }

  fun adjustDeliveries(delta: Int) = synchronized(lock) { deliveries += delta }

  val liveSubscriptions: Double get() = synchronized(lock) { subscriptions.toDouble() }

  val liveDeliveries: Double get() = synchronized(lock) { deliveries.toDouble() }
}

/**
 * Owned subscription: OPEN → CLOSING → CLOSED with in-flight delivery leases.
 *
 * `beginDelivery` / `endDelivery` track active callbacks. `close()` waits until
 * every delivery completes before finishing teardown, using async continuations
 * so a callback that requests close cannot deadlock itself.
 */
class LucentSubscription {
  private enum class State { OPEN, CLOSING, CLOSED }

  private val lock = Any()
  private var state = State.OPEN
  private var activeCallbacks = 0
  private val closeWaiters = mutableListOf<Continuation<Unit>>()

  /** Optional debug labels for lifetime sanitizer messages (P41). */
  @Volatile var createdAt: String = defaultLabel()
  @Volatile var closedAt: String = ""

  init {
    LucentSubscriptionCounts.adjustSubscriptions(1)
  }

  companion object {
    fun defaultLabel(): String {
      val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      fmt.timeZone = TimeZone.getTimeZone("UTC")
      return fmt.format(Date())
    }
  }

  val closed: Boolean get() = synchronized(lock) { state == State.CLOSED }

  val activeCallbackCount: Double get() = synchronized(lock) { activeCallbacks.toDouble() }

  private fun lifetimeMessage(action: String): String {
    val parts = mutableListOf("Subscription $action")
    if (createdAt.isNotEmpty()) parts.add("createdAt: $createdAt")
    if (closedAt.isNotEmpty()) parts.add("closedAt: $closedAt")
    return parts.joinToString("; ")
  }

  fun beginDelivery() = synchronized(lock) {
    when (state) {
      State.CLOSED -> throw LucentError("LIFETIME_ERROR", lifetimeMessage("used after close"))
      State.CLOSING -> throw LucentError("CLOSED", "Subscription no longer accepts delivery")
      State.OPEN -> {
        activeCallbacks += 1
        LucentSubscriptionCounts.adjustDeliveries(1)
      }
    }
  }

  fun endDelivery() {
    val shouldFinish = synchronized(lock) {
      if (activeCallbacks == 0) return
      activeCallbacks -= 1
      LucentSubscriptionCounts.adjustDeliveries(-1)
      state == State.CLOSING && activeCallbacks == 0
    }
    if (shouldFinish) finishClose()
  }

  /** Optional SDK cleanup hook (deregister listeners). Must leave the subscription terminal. */
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
          if (activeCallbacks == 0) {
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

/** Runs [body] then awaits [LucentSubscription.close] on every exit path. */
object LucentSubscriptionScope {
  suspend fun withSubscription(subscription: LucentSubscription, body: (LucentSubscription) -> Unit) {
    try {
      body(subscription)
    } finally {
      subscription.close()
    }
  }
}
