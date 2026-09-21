final class lucentInternal_8f133499183f7a85_Counter {
  var value: Double
  init(value: Double) {
    self.value = value
  }
}


func lucentInternal_8f133499183f7a85_Counter__get_value(lucentSelf: lucentInternal_8f133499183f7a85_Counter) throws -> Double {
  return lucentSelf.value
}

func lucentInternal_8f133499183f7a85_Counter__set_value(lucentSelf: lucentInternal_8f133499183f7a85_Counter, value: Double) throws -> Void {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentSelf
  lucentSelf.value = value
}

func lucentInternal_8f133499183f7a85_Counter__method_increment(lucentSelf: lucentInternal_8f133499183f7a85_Counter, delta: Double) throws -> Double {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentSelf
  lucentSelf.value = (lucentSelf.value + delta)
  return lucentSelf.value
}

func lucentInternal_8f133499183f7a85_Counter__create(initial: Double) throws -> lucentInternal_8f133499183f7a85_Counter {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentInternal_8f133499183f7a85_Counter(value: 0.0)
  lucentSelf.value = initial
  return lucentSelf
}

func makeCounter(initial: Double) throws -> lucentInternal_8f133499183f7a85_Counter {
  return try lucentInternal_8f133499183f7a85_Counter__create(initial: initial)
}

func advance(counter: lucentInternal_8f133499183f7a85_Counter) throws -> Double {
  return try lucentInternal_8f133499183f7a85_Counter__method_increment(lucentSelf: counter, delta: 1.0)
}
