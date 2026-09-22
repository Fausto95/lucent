package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Process-wide open database count for CI in-memory stubs. */
object LucentSqliteCounts {
  private val lock = Any()
  private var databases = 0

  fun adjustDatabases(delta: Int) = synchronized(lock) { databases += delta }

  val liveDatabases: Double get() = synchronized(lock) { databases.toDouble() }
}

/**
 * Borrowed transaction handle — valid only for the duration of `transaction`
 * (`retention: "call"`). Invalidated when the body returns.
 */
class LucentSQLiteTransaction(private val database: LucentSQLiteDatabase) {
  private var valid = true

  fun invalidate() {
    valid = false
  }

  fun execute(sql: String, params: MutableList<String>) {
    if (!valid) throw LucentError("TX_CLOSED", "Transaction is no longer valid")
    database.execute(sql, params)
  }

  fun query(sql: String, params: MutableList<String>): Double {
    if (!valid) throw LucentError("TX_CLOSED", "Transaction is no longer valid")
    return database.query(sql, params)
  }
}

/** CI SQLite stub backed by an in-memory table map with real rollback on throw. */
class LucentSQLiteDatabase private constructor() {
  private val lock = Any()
  private var isClosed = false
  private val store = mutableMapOf<String, MutableList<String>>()
  private var snapshot: Map<String, MutableList<String>>? = null

  init {
    LucentSqliteCounts.adjustDatabases(1)
  }

  companion object {
    fun open(path: String): LucentSQLiteDatabase {
      path.length // path reserved for real SQLite
      return LucentSQLiteDatabase()
    }
  }

  val closed: Boolean
    get() = synchronized(lock) { isClosed }

  fun execute(sql: String, params: MutableList<String>) {
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Database is closed")
      if (sql.uppercase().startsWith("THROW")) throw LucentError("TX_FORCE_FAIL", "Forced transaction failure")
      val key = params.firstOrNull() ?: sql
      if (sql.uppercase().startsWith("DELETE")) store.remove(key)
      else store[key] = params.toMutableList()
    }
  }

  /** Returns matching row count for the CI map. */
  fun query(sql: String, params: MutableList<String>): Double {
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Database is closed")
      val key = params.firstOrNull() ?: sql
      return if (store.containsKey(key)) 1.0 else 0.0
    }
  }

  /** Body receives a borrowed tx; commit on success, restore snapshot on throw. */
  fun transaction(body: (LucentSQLiteTransaction) -> Unit) {
    synchronized(lock) {
      if (isClosed) throw LucentError("CLOSED", "Database is closed")
      snapshot = store.mapValues { it.value.toMutableList() }
    }
    val tx = LucentSQLiteTransaction(this)
    try {
      body(tx)
      synchronized(lock) { snapshot = null }
    } catch (error: Throwable) {
      synchronized(lock) {
        snapshot?.let { snap ->
          store.clear()
          store.putAll(snap.mapValues { it.value.toMutableList() })
        }
        snapshot = null
      }
      throw error
    } finally {
      tx.invalidate()
    }
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val release = synchronized(lock) {
      if (isClosed) false
      else {
        isClosed = true
        true
      }
    }
    if (release) LucentSqliteCounts.adjustDatabases(-1)
    continuation.resume(Unit)
  }
}
