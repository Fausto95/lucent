package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

object LucentLocationCounts {
  private val lock = Any()
  private var providers = 0

  fun adjustProviders(delta: Int) = synchronized(lock) { providers += delta }

  val liveProviders: Double get() = synchronized(lock) { providers.toDouble() }
}

/** Owned position value — may be retained after the updates callback returns. */
class LucentPosition(
  val latitude: Double,
  val longitude: Double,
  val accuracy: Double,
  val timestamp: Double,
)

/** CI location provider stub. Keep-latest backpressure; stale/duplicate drops. */
class LucentLocationProvider {
  private val lock = Any()
  private var isClosed = false
  private var updatesCallback: ((LucentPosition) -> Double)? = null
  private var lastDelivered: LucentPosition? = null
  private var droppedStale = 0.0
  private var droppedDuplicate = 0.0

  init {
    LucentLocationCounts.adjustProviders(1)
  }

  val closed: Boolean
    get() = synchronized(lock) { isClosed }

  fun staleDrops(): Double = synchronized(lock) { droppedStale }

  fun duplicateDrops(): Double = synchronized(lock) { droppedDuplicate }

  fun updates(callback: (LucentPosition) -> Double): Double {
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Location provider is closed")
      updatesCallback = callback
    }
    return 1.0
  }

  /** Deliver a fake fix. Stale (older timestamp) and exact duplicates are dropped. */
  fun deliverFake(latitude: Double, longitude: Double, accuracy: Double, timestamp: Double): Double {
    val pair = synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Location provider is closed")
      if (LucentLocation.currentPermission() != "granted") {
        throw LucentError("PERMISSION_DENIED", "Location permission not granted")
      }
      val cb = updatesCallback ?: throw LucentError("NO_CALLBACK", "No updates subscription")
      lastDelivered?.let { last ->
        if (timestamp < last.timestamp) {
          droppedStale += 1.0
          return 0.0
        }
        if (timestamp == last.timestamp && latitude == last.latitude && longitude == last.longitude) {
          droppedDuplicate += 1.0
          return 0.0
        }
      }
      val position = LucentPosition(latitude, longitude, accuracy, timestamp)
      lastDelivered = position
      Pair(cb, position)
    }
    return pair.first(pair.second)
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val release = synchronized(lock) {
      if (isClosed) false
      else {
        isClosed = true
        updatesCallback = null
        true
      }
    }
    if (release) LucentLocationCounts.adjustProviders(-1)
    continuation.resume(Unit)
  }
}

object LucentLocation {
  private val lock = Any()
  @Volatile private var permissionValue: String = "granted"

  fun requestPermission(): String = synchronized(lock) { permissionValue }

  fun permissionState(): String = synchronized(lock) { permissionValue }

  /** CI-only: change permission union state (affects subsequent deliveries). */
  fun setPermission(state: String) = synchronized(lock) { permissionValue = state }

  fun currentPermission(): String = synchronized(lock) { permissionValue }
}
