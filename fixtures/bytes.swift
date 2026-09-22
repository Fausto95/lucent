func checksum(data: ArrayBuffer) throws -> Double {
  var sum: Double = 0.0
  var i: Double = 0.0
  while i < LucentBytes.length(data) {
    sum = sum + LucentBytes.get(data, i)
    i = i + 1.0
  }
  return sum.truncatingRemainder(dividingBy: 256.0)
}
