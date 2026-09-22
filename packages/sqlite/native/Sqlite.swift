import Foundation

/// Process-wide open database count for CI in-memory stubs.
enum LucentSqliteCounts {
  private static let lock = NSLock()
  private static var databases = 0

  static func adjustDatabases(_ delta: Int) {
    lock.lock()
    databases += delta
    lock.unlock()
  }

  static var liveDatabases: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(databases)
  }
}

/// Borrowed transaction handle — valid only for the duration of `transaction`
/// (`retention: "call"`). Invalidated when the body returns.
final class LucentSQLiteTransaction: @unchecked Sendable {
  private let database: LucentSQLiteDatabase
  private var valid = true

  init(database: LucentSQLiteDatabase) {
    self.database = database
  }

  func invalidate() {
    valid = false
  }

  func execute(sql: String, params: [String]) throws {
    guard valid else { throw LucentError(code: "TX_CLOSED") }
    try database.execute(sql: sql, params: params)
  }

  func query(sql: String, params: [String]) throws -> Double {
    guard valid else { throw LucentError(code: "TX_CLOSED") }
    return try database.query(sql: sql, params: params)
  }
}

/// CI SQLite stub backed by an in-memory table map with real rollback on throw.
final class LucentSQLiteDatabase: @unchecked Sendable {
  private let lock = NSLock()
  private var isClosed = false
  private var store: [String: [String]] = [:]
  private var snapshot: [String: [String]]?

  private init() {
    LucentSqliteCounts.adjustDatabases(1)
  }

  static func open(path: String) throws -> LucentSQLiteDatabase {
    _ = path
    return LucentSQLiteDatabase()
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return isClosed
  }

  func execute(sql: String, params: [String]) throws {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
    if sql.uppercased().hasPrefix("THROW") {
      throw LucentError(code: "TX_FORCE_FAIL")
    }
    let key = params.first ?? sql
    if sql.uppercased().hasPrefix("DELETE") {
      store.removeValue(forKey: key)
    } else {
      store[key] = params
    }
  }

  /// Returns matching row count for the CI map.
  func query(sql: String, params: [String]) throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
    let key = params.first ?? sql
    return store[key] == nil ? 0 : 1
  }

  /// Body receives a borrowed tx; commit on success, restore snapshot on throw.
  func transaction(body: (LucentSQLiteTransaction) throws -> Void) throws {
    lock.lock()
    guard !isClosed else {
      lock.unlock()
      throw LucentError(code: "CLOSED")
    }
    snapshot = store
    lock.unlock()
    let tx = LucentSQLiteTransaction(database: self)
    defer { tx.invalidate() }
    do {
      try body(tx)
      lock.lock()
      snapshot = nil
      lock.unlock()
    } catch {
      lock.lock()
      if let snap = snapshot { store = snap }
      snapshot = nil
      lock.unlock()
      throw error
    }
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      let release = !isClosed
      if release { isClosed = true }
      lock.unlock()
      if release { LucentSqliteCounts.adjustDatabases(-1) }
      continuation.resume()
    }
  }
}
