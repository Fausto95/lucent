import Foundation

func lucentInternal_736b35a22321c26_abs(value: Double) throws -> Double {
  return Swift.abs(value)
}

func lucentInternal_736b35a22321c26_sqrt(value: Double) throws -> Double {
  return value.squareRoot()
}

func lucentInternal_736b35a22321c26_floor(value: Double) throws -> Double {
  return value.rounded(.down)
}

func lucentInternal_736b35a22321c26_ceil(value: Double) throws -> Double {
  return value.rounded(.up)
}

func lucentInternal_736b35a22321c26_sin(value: Double) throws -> Double {
  return Foundation.sin(value)
}

func lucentInternal_736b35a22321c26_cos(value: Double) throws -> Double {
  return Foundation.cos(value)
}

func lucentInternal_736b35a22321c26_min(a: Double, b: Double) throws -> Double {
  return Swift.min(a, b)
}

func lucentInternal_736b35a22321c26_max(a: Double, b: Double) throws -> Double {
  return Swift.max(a, b)
}

func lucentInternal_2aaae6189ce4e2af_trim(value: String) throws -> String {
  return value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func lucentInternal_2aaae6189ce4e2af_contains(value: String, search: String) throws -> Bool {
  return value.contains(search)
}

func magnitude(value: Double) throws -> Double {
  return try lucentInternal_736b35a22321c26_sqrt(value: lucentInternal_736b35a22321c26_abs(value: value))
}

func matches(value: String) throws -> Bool {
  return try lucentInternal_2aaae6189ce4e2af_contains(value: lucentInternal_2aaae6189ce4e2af_trim(value: value), search: "lucent")
}
