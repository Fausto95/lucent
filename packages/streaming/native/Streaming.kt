package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.math.max
import kotlin.math.min

object LucentStreaming {
  private val lock = Any()
  private var buffers = 0

  fun adjustBuffers(delta: Int) = synchronized(lock) { buffers += delta }

  fun liveBuffers(): Double = synchronized(lock) { buffers.toDouble() }

  /** Identity transform that allocates a new owned buffer. */
  fun transform(chunk: ArrayBuffer): ArrayBuffer {
    val bytes = LucentBytes.toByteArray(chunk)
    adjustBuffers(1)
    return LucentBytes.fromByteArray(bytes)
  }
}

/** CI chunk source: owned buffers, prefetch bounded by `capacity`, cancellable. */
class LucentFileChunkSource private constructor(chunkSize: Double, capacity: Double) {
  private val lock = Any()
  private var isClosed = false
  private var cancelled = false
  val capacity: Double = capacity
  private val chunkSize: Int = max(1, chunkSize.toInt())
  private var remaining: Int = this.chunkSize * max(1, capacity.toInt())
  private var inFlight = 0
  private val queue = mutableListOf<ArrayBuffer>()

  companion object {
    fun open(path: String, chunkSize: Double, capacity: Double): LucentFileChunkSource {
      path.length
      return LucentFileChunkSource(chunkSize, capacity)
    }
  }

  val closed: Boolean
    get() = synchronized(lock) { isClosed }

  fun cancel() {
    synchronized(lock) {
      cancelled = true
      queue.clear()
    }
  }

  /** Prefetch one chunk into the bounded queue (CI chunked transform helper). */
  fun enqueueTransform(): Double {
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Chunk source is closed")
      if (cancelled) throw LucentError("CANCELLED", "Chunk source was cancelled")
      if (queue.size >= capacity.toInt()) throw LucentError("BACKPRESSURE", "Prefetch capacity exceeded")
      if (remaining <= 0) throw LucentError("EOF", "End of stream")
      val size = min(chunkSize, remaining)
      remaining -= size
      val raw = LucentBytes.fromByteArray(ByteArray(size) { 0x41.toByte() })
      val transformed = LucentStreaming.transform(raw)
      queue.add(transformed)
      return queue.size.toDouble()
    }
  }

  suspend fun readChunk(): ArrayBuffer = suspendCoroutine { continuation ->
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Chunk source is closed")
      if (cancelled) throw LucentError("CANCELLED", "Chunk source was cancelled")
      if (queue.isNotEmpty()) {
        continuation.resume(queue.removeAt(0))
        return@suspendCoroutine
      }
      if (inFlight >= capacity.toInt()) throw LucentError("BACKPRESSURE", "Prefetch capacity exceeded")
      if (remaining <= 0) throw LucentError("EOF", "End of stream")
      val size = min(chunkSize, remaining)
      remaining -= size
      inFlight += 1
      LucentStreaming.adjustBuffers(1)
      continuation.resume(LucentBytes.fromByteArray(ByteArray(size) { 0x41.toByte() }))
    }
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    synchronized(lock) {
      isClosed = true
      cancelled = true
      queue.clear()
    }
    continuation.resume(Unit)
  }
}

/** CI write sink. `write` borrows the chunk for the awaited call duration. */
class LucentFileWriteSink private constructor() {
  private val lock = Any()
  private var isClosed = false
  private var written = 0

  companion object {
    fun open(path: String): LucentFileWriteSink {
      path.length
      return LucentFileWriteSink()
    }
  }

  val closed: Boolean
    get() = synchronized(lock) { isClosed }

  suspend fun write(chunk: ArrayBuffer): Unit = suspendCoroutine { continuation ->
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Write sink is closed")
      written += LucentBytes.length(chunk).toInt()
    }
    continuation.resume(Unit)
  }

  suspend fun flush(): Unit = suspendCoroutine { continuation ->
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Write sink is closed")
    }
    continuation.resume(Unit)
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    synchronized(lock) { isClosed = true }
    continuation.resume(Unit)
  }
}
