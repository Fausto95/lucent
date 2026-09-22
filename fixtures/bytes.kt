fun checksum(data: ArrayBuffer): Double {
  var sum: Double = 0.0
  var i: Double = 0.0
  while (i < LucentBytes.length(data)) {
    sum = sum + LucentBytes.get(data, i)
    i = i + 1.0
  }
  return sum % 256.0
}
