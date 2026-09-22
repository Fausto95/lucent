class lucentInternal_8f133499183f7a85_Counter(var value: Double)


fun lucentInternal_8f133499183f7a85_Counter__get_value(lucentSelf: lucentInternal_8f133499183f7a85_Counter): Double {
  return lucentSelf.value
}

fun lucentInternal_8f133499183f7a85_Counter__set_value(lucentSelf: lucentInternal_8f133499183f7a85_Counter, value: Double): Unit {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentSelf
  lucentSelf.value = value
}

fun lucentInternal_8f133499183f7a85_Counter__method_increment(lucentSelf: lucentInternal_8f133499183f7a85_Counter, delta: Double): Double {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentSelf
  lucentSelf.value = lucentSelf.value + delta
  return lucentSelf.value
}

fun lucentInternal_8f133499183f7a85_Counter__create(initial: Double): lucentInternal_8f133499183f7a85_Counter {
  var lucentSelf: lucentInternal_8f133499183f7a85_Counter = lucentInternal_8f133499183f7a85_Counter(value = 0.0)
  lucentSelf.value = initial
  return lucentSelf
}

fun makeCounter(initial: Double): lucentInternal_8f133499183f7a85_Counter {
  return lucentInternal_8f133499183f7a85_Counter__create(initial)
}

fun advance(counter: lucentInternal_8f133499183f7a85_Counter): Double {
  return lucentInternal_8f133499183f7a85_Counter__method_increment(counter, 1.0)
}
