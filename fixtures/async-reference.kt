typealias lucentInternal_2e40afc3526ae0ac_TaskScope = LucentTaskScope


typealias lucentInternal_2e40afc3526ae0ac_TaskGroup = LucentTaskGroup


typealias lucentInternal_2e40afc3526ae0ac_NativeTask = LucentTask


fun lucentInternal_2e40afc3526ae0ac_TaskScope__create(): lucentInternal_2e40afc3526ae0ac_TaskScope {
  return LucentTaskScope()
}

fun lucentInternal_2e40afc3526ae0ac_TaskScope__get_closing(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope): Boolean {
  return lucentSelf.closing
}

fun lucentInternal_2e40afc3526ae0ac_TaskScope__get_activeCount(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope): Double {
  return lucentSelf.activeCount
}

fun lucentInternal_2e40afc3526ae0ac_TaskScope__method_begin(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope): lucentInternal_2e40afc3526ae0ac_NativeTask {
  return lucentSelf.begin()
}

suspend fun lucentInternal_2e40afc3526ae0ac_TaskScope__method_close(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope): Unit {
  lucentSelf.close()
}

fun lucentInternal_2e40afc3526ae0ac_TaskGroup__create(): lucentInternal_2e40afc3526ae0ac_TaskGroup {
  return LucentTaskGroup()
}

fun lucentInternal_2e40afc3526ae0ac_TaskGroup__get_closing(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskGroup): Boolean {
  return lucentSelf.closing
}

fun lucentInternal_2e40afc3526ae0ac_TaskGroup__get_activeCount(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskGroup): Double {
  return lucentSelf.activeCount
}

fun lucentInternal_2e40afc3526ae0ac_TaskGroup__method_begin(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskGroup): lucentInternal_2e40afc3526ae0ac_NativeTask {
  return lucentSelf.begin()
}

suspend fun lucentInternal_2e40afc3526ae0ac_TaskGroup__method_close(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskGroup): Unit {
  lucentSelf.close()
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__create(scope: lucentInternal_2e40afc3526ae0ac_TaskScope): lucentInternal_2e40afc3526ae0ac_NativeTask {
  return scope.begin()
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__get_cancelled(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask): Boolean {
  return lucentSelf.cancelled
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__get_finished(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask): Boolean {
  return lucentSelf.finished
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__method_cancel(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask): Unit {
  lucentSelf.cancel()
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__method_finish(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask): Boolean {
  return lucentSelf.finish()
}

fun lucentInternal_2e40afc3526ae0ac_NativeTask__method_throwIfCancelled(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask): Unit {
  lucentSelf.throwIfCancelled()
}

fun open(): lucentInternal_2e40afc3526ae0ac_TaskScope {
  return lucentInternal_2e40afc3526ae0ac_TaskScope__create()
}

suspend fun settle(scope: lucentInternal_2e40afc3526ae0ac_TaskScope): Double {
  val before: Double = lucentInternal_2e40afc3526ae0ac_TaskScope__get_activeCount(scope)
  lucentInternal_2e40afc3526ae0ac_TaskScope__method_close(scope)
  return before
}
