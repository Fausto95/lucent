import Foundation

enum LucentStreaming {
  private static let lock = NSLock()
  private static var buffers = 0

  static func adjustBuffers(_ delta: Int) {
    lock.lock()
    buffers += delta
    lock.unlock()
  }

  static func liveBuffers() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(buffers)
  }

  /// Identity transform that allocates a new owned buffer.
  static func transform(chunk: ArrayBuffer) throws -> ArrayBuffer {
    let data = LucentBytes.data(chunk)
    adjustBuffers(1)
    return try LucentBytes.fromData(data)
  }
}

/// CI chunk source: owned buffers, prefetch bounded by `capacity`, cancellable.
final class LucentFileChunkSource: @unchecked Sendable {
  private let lock = NSLock()
  private var isClosed = false
  private var cancelled = false
  let capacity: Double
  private let chunkSize: Int
  private var remaining: Int
  private var inFlight = 0
  private var queue: [ArrayBuffer] = []

  private init(chunkSize: Double, capacity: Double) {
    self.chunkSize = max(1, Int(chunkSize))
    self.capacity = capacity
    self.remaining = self.chunkSize * max(1, Int(capacity))
  }

  static func open(path: String, chunkSize: Double, capacity: Double) throws -> LucentFileChunkSource {
    _ = path
    return LucentFileChunkSource(chunkSize: chunkSize, capacity: capacity)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return isClosed
  }

  func cancel() {
    lock.lock()
    cancelled = true
    queue.removeAll()
    lock.unlock()
  }

  /// Prefetch one chunk into the bounded queue (CI chunked transform helper).
  func enqueueTransform() throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
    guard !cancelled else { throw LucentError(code: "CANCELLED") }
    guard queue.count < Int(capacity) else { throw LucentError(code: "BACKPRESSURE") }
    guard remaining > 0 else { throw LucentError(code: "EOF") }
    let size = min(chunkSize, remaining)
    remaining -= size
    let raw = try LucentBytes.fromData(Data(repeating: 0x41, count: size))
    let transformed = try LucentStreaming.transform(chunk: raw)
    queue.append(transformed)
    return Double(queue.count)
  }

  func readChunk() async throws -> ArrayBuffer {
    lock.lock()
    guard !isClosed else {
      lock.unlock()
      throw LucentError(code: "CLOSED")
    }
    guard !cancelled else {
      lock.unlock()
      throw LucentError(code: "CANCELLED")
    }
    if !queue.isEmpty {
      let next = queue.removeFirst()
      lock.unlock()
      return next
    }
    guard inFlight < Int(capacity) else {
      lock.unlock()
      throw LucentError(code: "BACKPRESSURE")
    }
    guard remaining > 0 else {
      lock.unlock()
      throw LucentError(code: "EOF")
    }
    let size = min(chunkSize, remaining)
    remaining -= size
    inFlight += 1
    lock.unlock()
    LucentStreaming.adjustBuffers(1)
    return try LucentBytes.fromData(Data(repeating: 0x41, count: size))
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      isClosed = true
      cancelled = true
      queue.removeAll()
      lock.unlock()
      continuation.resume()
    }
  }
}

/// CI write sink. `write` borrows the chunk for the awaited call duration.
final class LucentFileWriteSink: @unchecked Sendable {
  private let lock = NSLock()
  private var isClosed = false
  private var written = 0

  private init() {}

  static func open(path: String) throws -> LucentFileWriteSink {
    _ = path
    return LucentFileWriteSink()
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return isClosed
  }

  func write(chunk: ArrayBuffer) async throws {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
    written += Int(LucentBytes.length(chunk))
  }

  func flush() async throws {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      isClosed = true
      lock.unlock()
      continuation.resume()
    }
  }
}
