package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Process-wide BLE resource counts for CI fake peripherals. */
object LucentBluetoothCounts {
  private val lock = Any()
  private var scanners = 0
  private var connections = 0

  fun adjustScanners(delta: Int) = synchronized(lock) { scanners += delta }

  fun adjustConnections(delta: Int) = synchronized(lock) { connections += delta }

  val liveScanners: Double get() = synchronized(lock) { scanners.toDouble() }

  val liveConnections: Double get() = synchronized(lock) { connections.toDouble() }
}

/** Package policy: notification buffer capacity (buffer(n)). */
const val LucentBluetoothNotificationCapacity = 32

/** CI BLE scanner stub with a scan-results queue and fake peripherals (`fake-1`, …). */
class LucentBluetoothScanner {
  private enum class State { IDLE, SCANNING, CLOSED }

  private val lock = Any()
  private var state = State.IDLE
  private val scanResults = mutableListOf<String>()

  init {
    LucentBluetoothCounts.adjustScanners(1)
  }

  val closed: Boolean
    get() = synchronized(lock) { state == State.CLOSED }

  fun start() {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Bluetooth scanner is closed")
      state = State.SCANNING
    }
  }

  fun stop() {
    synchronized(lock) {
      if (state == State.CLOSED) return
      state = State.IDLE
    }
  }

  /** CI-only: enqueue a discovered peripheral id while scanning. */
  fun enqueueScanResult(peripheralId: String) {
    synchronized(lock) {
      if (state != State.SCANNING) throw LucentError("NOT_SCANNING", "Scanner is not scanning")
      scanResults.add(peripheralId)
    }
  }

  /** Pop the oldest scan result, or empty string when the queue is empty. */
  fun pollScanResult(): String {
    synchronized(lock) {
      if (state == State.CLOSED) throw LucentError("CLOSED", "Bluetooth scanner is closed")
      if (scanResults.isEmpty()) return ""
      return scanResults.removeAt(0)
    }
  }

  suspend fun connect(peripheralId: String): LucentBluetoothConnection = suspendCoroutine { continuation ->
    val ok = synchronized(lock) { state == State.SCANNING }
    if (!ok) {
      continuation.resumeWith(Result.failure(LucentError("NOT_SCANNING", "Scanner is not scanning")))
      return@suspendCoroutine
    }
    if (!peripheralId.startsWith("fake-")) {
      continuation.resumeWith(Result.failure(LucentError("UNKNOWN_PERIPHERAL", "Unknown peripheral")))
      return@suspendCoroutine
    }
    continuation.resume(LucentBluetoothConnection(peripheralId))
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val release = synchronized(lock) {
      if (state == State.CLOSED) false
      else {
        state = State.CLOSED
        scanResults.clear()
        true
      }
    }
    if (release) LucentBluetoothCounts.adjustScanners(-1)
    continuation.resume(Unit)
  }
}

/** CI BLE connection stub with a connection state machine and bounded notification buffer. */
class LucentBluetoothConnection(private val peripheralId: String) {
  private enum class ConnState { CONNECTING, CONNECTED, DISCONNECTING, DISCONNECTED }

  private val lock = Any()
  private var connState = ConnState.CONNECTING
  private val storage = mutableMapOf<String, ByteArray>()
  private var notificationCallback: ((ArrayBuffer) -> Double)? = null
  private var notificationCharacteristic: String? = null
  private var pendingNotifications = 0

  init {
    LucentBluetoothCounts.adjustConnections(1)
    connState = ConnState.CONNECTED
  }

  val closed: Boolean
    get() = synchronized(lock) { connState == ConnState.DISCONNECTED }

  val connectionState: String
    get() = synchronized(lock) {
      when (connState) {
        ConnState.CONNECTING -> "connecting"
        ConnState.CONNECTED -> "connected"
        ConnState.DISCONNECTING -> "disconnecting"
        ConnState.DISCONNECTED -> "disconnected"
      }
    }

  suspend fun read(characteristic: String): ArrayBuffer = suspendCoroutine { continuation ->
    synchronized(lock) {
      if (connState != ConnState.CONNECTED) throw LucentError("CLOSED", "Connection is closed")
      val bytes = storage[characteristic] ?: peripheralId.toByteArray(Charsets.UTF_8)
      continuation.resume(LucentBytes.fromByteArray(bytes))
    }
  }

  suspend fun write(characteristic: String, payload: ArrayBuffer): Unit = suspendCoroutine { continuation ->
    synchronized(lock) {
      if (connState != ConnState.CONNECTED) throw LucentError("CLOSED", "Connection is closed")
      storage[characteristic] = LucentBytes.toByteArray(payload)
    }
    continuation.resume(Unit)
  }

  /** Package policy buffer(n=32) with backpressure "block"; overflow throws. */
  fun notifications(characteristic: String, callback: (ArrayBuffer) -> Double): Double {
    synchronized(lock) {
      if (connState != ConnState.CONNECTED) throw LucentError("CLOSED", "Connection is closed")
      notificationCharacteristic = characteristic
      notificationCallback = callback
      pendingNotifications = 0
    }
    return 1.0
  }

  fun deliverNotification(characteristic: String, payload: ArrayBuffer): Double {
    val callback = synchronized(lock) {
      if (connState != ConnState.CONNECTED) throw LucentError("CLOSED", "Connection is closed")
      if (notificationCharacteristic != characteristic) throw LucentError("NO_CALLBACK", "No matching subscription")
      val cb = notificationCallback ?: throw LucentError("NO_CALLBACK", "No notifications subscription")
      if (pendingNotifications >= LucentBluetoothNotificationCapacity) {
        throw LucentError("BUFFER_OVERFLOW", "Notification buffer capacity exceeded")
      }
      pendingNotifications += 1
      cb
    }
    try {
      return callback(payload)
    } finally {
      synchronized(lock) { pendingNotifications -= 1 }
    }
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val release = synchronized(lock) {
      if (connState == ConnState.DISCONNECTED) false
      else {
        connState = ConnState.DISCONNECTING
        notificationCallback = null
        pendingNotifications = 0
        connState = ConnState.DISCONNECTED
        true
      }
    }
    if (release) LucentBluetoothCounts.adjustConnections(-1)
    continuation.resume(Unit)
  }
}
