typealias lucentInternal_2e40afc3526ae0ac_TaskScope = LucentTaskScope


typealias lucentInternal_2e40afc3526ae0ac_NativeTask = LucentTask


func lucentInternal_2e40afc3526ae0ac_TaskScope__create() throws -> lucentInternal_2e40afc3526ae0ac_TaskScope {
  return LucentTaskScope()
}

func lucentInternal_2e40afc3526ae0ac_TaskScope__get_closing(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope) throws -> Bool {
  return lucentSelf.closing
}

func lucentInternal_2e40afc3526ae0ac_TaskScope__get_activeCount(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope) throws -> Double {
  return lucentSelf.activeCount
}

func lucentInternal_2e40afc3526ae0ac_TaskScope__method_begin(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope) throws -> lucentInternal_2e40afc3526ae0ac_NativeTask {
  return try lucentSelf.begin()
}

func lucentInternal_2e40afc3526ae0ac_TaskScope__method_close(lucentSelf: lucentInternal_2e40afc3526ae0ac_TaskScope) async throws -> Void {
  await lucentSelf.close()
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__create(scope: lucentInternal_2e40afc3526ae0ac_TaskScope) throws -> lucentInternal_2e40afc3526ae0ac_NativeTask {
  return try scope.begin()
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__get_cancelled(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask) throws -> Bool {
  return lucentSelf.cancelled
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__get_finished(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask) throws -> Bool {
  return lucentSelf.finished
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__method_cancel(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask) throws -> Void {
  lucentSelf.cancel()
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__method_finish(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask) throws -> Bool {
  return lucentSelf.finish()
}

func lucentInternal_2e40afc3526ae0ac_NativeTask__method_throwIfCancelled(lucentSelf: lucentInternal_2e40afc3526ae0ac_NativeTask) throws -> Void {
  try lucentSelf.throwIfCancelled()
}

func open() throws -> lucentInternal_2e40afc3526ae0ac_TaskScope {
  return try lucentInternal_2e40afc3526ae0ac_TaskScope__create()
}

func settle(scope: lucentInternal_2e40afc3526ae0ac_TaskScope) async throws -> Double {
  let before: Double = try lucentInternal_2e40afc3526ae0ac_TaskScope__get_activeCount(lucentSelf: scope)
  _ = try await lucentInternal_2e40afc3526ae0ac_TaskScope__method_close(lucentSelf: scope)
  return before
}
